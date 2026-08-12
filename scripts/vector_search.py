"""Build and query a local semantic index for one knowledge space."""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterable


DEFAULT_MODEL = "BAAI/bge-small-zh-v1.5"
INDEX_VERSION = 1


@dataclass(frozen=True)
class Chunk:
    """A searchable Markdown passage with source information."""

    chunk_id: str
    file: str
    path: str
    heading: str
    text: str


def write_event(event: str, **payload: Any) -> None:
    """Write a structured status event to stderr."""

    print(
        json.dumps({"type": "vector", "event": event, **payload}, ensure_ascii=False),
        file=sys.stderr,
        flush=True,
    )


def sha256_file(path: Path) -> str:
    """Return a stable SHA-256 digest for a file."""

    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def split_long_text(text: str, max_chars: int = 900, overlap: int = 140) -> list[str]:
    """Split text into overlapping character windows at paragraph boundaries."""

    paragraphs = [item.strip() for item in text.split("\n\n") if item.strip()]
    chunks: list[str] = []
    current = ""
    for paragraph in paragraphs:
        if current and len(current) + len(paragraph) + 2 > max_chars:
            chunks.append(current.strip())
            current = f"{current[-overlap:]}\n\n{paragraph}"
        else:
            current = f"{current}\n\n{paragraph}".strip()
        while len(current) > max_chars * 1.35:
            chunks.append(current[:max_chars].strip())
            current = current[max_chars - overlap :].strip()
    if current:
        chunks.append(current.strip())
    return chunks


def chunk_markdown(path: Path, root: Path) -> list[Chunk]:
    """Split one Markdown file into heading-aware semantic passages."""

    content = path.read_text(encoding="utf-8", errors="replace")
    relative = str(path.relative_to(root))
    sections: list[tuple[str, list[str]]] = []
    heading = path.stem
    lines: list[str] = []
    for raw_line in content.splitlines():
        line = raw_line.rstrip()
        if line.lstrip().startswith("#"):
            if lines:
                sections.append((heading, lines))
            heading = line.lstrip("# ").strip() or heading
            lines = [line]
        else:
            lines.append(line)
    if lines:
        sections.append((heading, lines))

    chunks: list[Chunk] = []
    for section_index, (section_heading, section_lines) in enumerate(sections):
        section_text = "\n".join(section_lines).strip()
        if not section_text:
            continue
        for part_index, part in enumerate(split_long_text(section_text)):
            searchable = f"文件：{path.stem}\n章节：{section_heading}\n{part}".strip()
            chunk_id = hashlib.sha256(
                f"{relative}:{section_index}:{part_index}:{searchable}".encode("utf-8")
            ).hexdigest()[:24]
            chunks.append(
                Chunk(
                    chunk_id=chunk_id,
                    file=path.name,
                    path=str(path),
                    heading=section_heading,
                    text=searchable,
                )
            )
    return chunks


def normalize(vector: Iterable[float]) -> list[float]:
    """Normalize a vector for cosine similarity."""

    values = [float(value) for value in vector]
    magnitude = math.sqrt(sum(value * value for value in values)) or 1.0
    return [value / magnitude for value in values]


def load_embedder(model_name: str, cache_dir: Path):
    """Load FastEmbed lazily so setup failures have a clear message."""

    try:
        from fastembed import TextEmbedding
    except ImportError as error:
        raise RuntimeError(
            "缺少 fastembed，请在项目虚拟环境执行 pip install fastembed。"
        ) from error
    cache_dir.mkdir(parents=True, exist_ok=True)
    return TextEmbedding(model_name=model_name, cache_dir=str(cache_dir))


def read_index(index_path: Path) -> dict[str, Any] | None:
    """Read an existing index, returning None for missing or invalid data."""

    try:
        return json.loads(index_path.read_text(encoding="utf-8"))
    except (FileNotFoundError, json.JSONDecodeError, OSError):
        return None


def build_index(
    knowledge_dir: Path,
    index_path: Path,
    model_name: str,
    cache_dir: Path,
    force: bool = False,
) -> dict[str, Any]:
    """Incrementally build a local vector index for Markdown files."""

    knowledge_dir.mkdir(parents=True, exist_ok=True)
    files = sorted(knowledge_dir.rglob("*.md"))
    hashes = {str(path.relative_to(knowledge_dir)): sha256_file(path) for path in files}
    previous = read_index(index_path)
    if (
        not force
        and previous
        and previous.get("version") == INDEX_VERSION
        and previous.get("model") == model_name
        and previous.get("files") == hashes
    ):
        return previous

    previous_chunks: dict[str, list[dict[str, Any]]] = {}
    if previous and previous.get("model") == model_name:
        for item in previous.get("chunks", []):
            relative_path = item.get("relativePath", "")
            previous_chunks.setdefault(relative_path, []).append(item)

    unchanged_files = {
        relative_path
        for relative_path, file_hash in hashes.items()
        if previous
        and previous.get("files", {}).get(relative_path) == file_hash
        and relative_path in previous_chunks
    }
    reusable = [
        chunk
        for relative_path in unchanged_files
        for chunk in previous_chunks[relative_path]
    ]
    changed_paths = [
        path
        for path in files
        if str(path.relative_to(knowledge_dir)) not in unchanged_files
    ]
    write_event(
        "building",
        files=len(files),
        changedFiles=len(changed_paths),
        reusedFiles=len(unchanged_files),
    )
    fresh_chunks = [
        chunk
        for file_path in changed_paths
        for chunk in chunk_markdown(file_path, knowledge_dir)
    ]
    if not reusable and not fresh_chunks:
        payload = {
            "version": INDEX_VERSION,
            "model": model_name,
            "files": hashes,
            "dimensions": 0,
            "chunks": [],
        }
    else:
        vectors: list[list[float]] = []
        if fresh_chunks:
            embedder = load_embedder(model_name, cache_dir)
            vectors = [
                normalize(vector)
                for vector in embedder.embed([chunk.text for chunk in fresh_chunks])
            ]
        fresh_items = [
            {
                "id": chunk.chunk_id,
                "file": chunk.file,
                "path": chunk.path,
                "relativePath": str(Path(chunk.path).relative_to(knowledge_dir)),
                "heading": chunk.heading,
                "text": chunk.text,
                "vector": vector,
            }
            for chunk, vector in zip(fresh_chunks, vectors, strict=True)
        ]
        all_items = reusable + fresh_items
        payload = {
            "version": INDEX_VERSION,
            "model": model_name,
            "files": hashes,
            "dimensions": len(all_items[0]["vector"]) if all_items else 0,
            "chunks": all_items,
        }
    index_path.parent.mkdir(parents=True, exist_ok=True)
    temporary = index_path.with_suffix(".tmp")
    temporary.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
    temporary.replace(index_path)
    write_event(
        "built",
        files=len(files),
        chunks=len(payload["chunks"]),
        changedFiles=len(changed_paths),
    )
    return payload


def cosine_similarity(left: list[float], right: list[float]) -> float:
    """Return cosine similarity for normalized vectors."""

    return sum(a * b for a, b in zip(left, right, strict=True))


def search_index(
    index: dict[str, Any],
    query: str,
    model_name: str,
    cache_dir: Path,
    limit: int,
) -> list[dict[str, Any]]:
    """Return the most semantically similar chunks."""

    if not index.get("chunks"):
        return []
    embedder = load_embedder(model_name, cache_dir)
    query_vector = normalize(next(iter(embedder.query_embed(query))))
    ranked = sorted(
        (
            {
                "file": chunk["file"],
                "path": chunk["path"],
                "heading": chunk["heading"],
                "text": chunk["text"],
                "semanticScore": round(cosine_similarity(query_vector, chunk["vector"]), 6),
            }
            for chunk in index["chunks"]
        ),
        key=lambda item: item["semanticScore"],
        reverse=True,
    )
    return ranked[: max(1, min(limit, 30))]


def parse_args() -> argparse.Namespace:
    """Parse command-line arguments."""

    parser = argparse.ArgumentParser(description="Local vector index and semantic search")
    parser.add_argument("command", choices=["build", "search"])
    parser.add_argument("--knowledge-dir", type=Path, required=True)
    parser.add_argument("--index", type=Path, required=True)
    parser.add_argument("--model", default=os.environ.get("VECTOR_MODEL", DEFAULT_MODEL))
    parser.add_argument("--cache-dir", type=Path, required=True)
    parser.add_argument("--query", default="")
    parser.add_argument("--limit", type=int, default=12)
    parser.add_argument("--force", action="store_true")
    return parser.parse_args()


def main() -> int:
    """Build or query the vector index and print a JSON response."""

    args = parse_args()
    try:
        index = build_index(
            args.knowledge_dir,
            args.index,
            args.model,
            args.cache_dir,
            force=args.force,
        )
        results = (
            search_index(index, args.query, args.model, args.cache_dir, args.limit)
            if args.command == "search"
            else []
        )
        print(
            json.dumps(
                {
                    "ok": True,
                    "model": args.model,
                    "files": len(index.get("files", {})),
                    "chunks": len(index.get("chunks", [])),
                    "results": results,
                },
                ensure_ascii=False,
            )
        )
        return 0
    except (OSError, RuntimeError, ValueError) as error:
        print(json.dumps({"ok": False, "error": str(error)}, ensure_ascii=False))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
