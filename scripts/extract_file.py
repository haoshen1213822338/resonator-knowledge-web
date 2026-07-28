"""Extract readable text from common office documents.

The web app calls this script after a file upload. It converts supported
binary formats into plain Markdown-like text so the AI organizer can work from
local extracted content instead of raw files.
"""

from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import Any


SUPPORTED_EXTENSIONS = {
    ".docx",
    ".pdf",
    ".xlsx",
    ".pptx",
    ".md",
    ".txt",
    ".csv",
    ".png",
    ".jpg",
    ".jpeg",
    ".webp",
    ".bmp",
    ".mp4",
    ".mov",
    ".mkv",
    ".avi",
    ".webm",
    ".m4v",
}

VIDEO_EXTENSIONS = {".mp4", ".mov", ".mkv", ".avi", ".webm", ".m4v"}

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8")
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8")


def read_text_file(path: Path) -> str:
    """Read a text-like file with practical encoding fallbacks."""

    for encoding in ("utf-8-sig", "utf-8", "gb18030"):
        try:
            return path.read_text(encoding=encoding)
        except UnicodeDecodeError:
            continue
    return path.read_text(encoding="utf-8", errors="replace")


def extract_docx(path: Path) -> str:
    """Extract paragraphs and tables from a Word document."""

    from docx import Document

    document = Document(path)
    parts: list[str] = []

    for paragraph in document.paragraphs:
        text = paragraph.text.strip()
        if text:
            parts.append(text)

    for table_index, table in enumerate(document.tables, 1):
        rows: list[str] = []
        for row in table.rows:
            cells = [cell.text.strip().replace("\n", " ") for cell in row.cells]
            if any(cells):
                rows.append(" | ".join(cells))
        if rows:
            parts.append(f"## 表格 {table_index}\n" + "\n".join(rows))

    return "\n\n".join(parts)


def extract_pdf(path: Path) -> str:
    """Extract text and simple tables from a PDF."""

    try:
        import pdfplumber
    except ImportError:
        pdfplumber = None

    if pdfplumber is not None:
        parts: list[str] = []
        with pdfplumber.open(path) as pdf:
            for page_index, page in enumerate(pdf.pages, 1):
                page_text = page.extract_text() or ""
                if page_text.strip():
                    parts.append(f"## 第 {page_index} 页\n{page_text.strip()}")
        return "\n\n".join(parts)

    from pypdf import PdfReader

    reader = PdfReader(str(path))
    parts = []
    for page_index, page in enumerate(reader.pages, 1):
        page_text = page.extract_text() or ""
        if page_text.strip():
            parts.append(f"## 第 {page_index} 页\n{page_text.strip()}")
    return "\n\n".join(parts)


def extract_xlsx(path: Path) -> str:
    """Extract visible cell values from an Excel workbook."""

    from openpyxl import load_workbook

    workbook = load_workbook(path, data_only=True, read_only=True)
    parts: list[str] = []

    for sheet in workbook.worksheets:
        rows: list[str] = []
        for row in sheet.iter_rows(values_only=True):
            values = ["" if value is None else str(value).strip() for value in row]
            while values and not values[-1]:
                values.pop()
            if any(values):
                rows.append(" | ".join(values))
        if rows:
            parts.append(f"## 工作表：{sheet.title}\n" + "\n".join(rows))

    return "\n\n".join(parts)


def extract_pptx(path: Path) -> str:
    """Extract slide text and table cells from a PowerPoint file."""

    from pptx import Presentation

    presentation = Presentation(path)
    parts: list[str] = []

    for slide_index, slide in enumerate(presentation.slides, 1):
        slide_parts: list[str] = []
        for shape in slide.shapes:
            if hasattr(shape, "text"):
                text = shape.text.strip()
                if text:
                    slide_parts.append(text)
            if getattr(shape, "has_table", False):
                for row in shape.table.rows:
                    cells = [cell.text.strip().replace("\n", " ") for cell in row.cells]
                    if any(cells):
                        slide_parts.append(" | ".join(cells))
        if slide_parts:
            parts.append(f"## 幻灯片 {slide_index}\n" + "\n\n".join(slide_parts))

    return "\n\n".join(parts)


def extract_image(path: Path) -> str:
    """Extract visible text from an image by OCR."""

    try:
        from rapidocr_onnxruntime import RapidOCR
    except ImportError as exc:
        raise RuntimeError(
            "当前 Python 环境未安装 OCR 依赖，请先安装 rapidocr-onnxruntime。"
        ) from exc

    engine = RapidOCR()
    result, _ = engine(str(path))
    if not result:
        return ""

    lines: list[str] = []
    for item in result:
        if len(item) < 2:
            continue
        text = str(item[1]).strip()
        score = item[2] if len(item) > 2 else None
        if not text:
            continue
        if isinstance(score, (int, float)):
            lines.append(f"- {text}（置信度：{score:.2f}）")
        else:
            lines.append(f"- {text}")

    return "\n".join(lines)


def require_ffmpeg() -> str:
    """Return the ffmpeg executable path or raise a clear setup error."""

    executable = os.environ.get("FFMPEG_PATH") or shutil.which("ffmpeg")
    if not executable:
        raise RuntimeError(
            "视频解析需要先安装 ffmpeg，并确保命令行可以直接运行 ffmpeg。"
        )
    return executable


def run_command(command: list[str]) -> subprocess.CompletedProcess[str]:
    """Run a command and return text output for diagnostics."""

    try:
        return subprocess.run(
            command,
            check=True,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
        )
    except subprocess.CalledProcessError as exc:
        detail = (exc.stderr or exc.stdout or str(exc)).strip()
        raise RuntimeError(f"视频处理命令执行失败：{detail[-2000:]}") from exc


def transcribe_audio(audio_path: Path) -> str:
    """Transcribe audio using faster-whisper first, then whisper if installed."""

    model_name = os.environ.get("VIDEO_WHISPER_MODEL", "base")

    try:
      from faster_whisper import WhisperModel
    except ImportError:
      WhisperModel = None

    if WhisperModel is not None:
        model = WhisperModel(model_name, device=os.environ.get("VIDEO_WHISPER_DEVICE", "cpu"))
        segments, _ = model.transcribe(str(audio_path), language="zh", vad_filter=True)
        lines = []
        for segment in segments:
            text = segment.text.strip()
            if text:
                lines.append(f"- {format_timestamp(segment.start)} - {format_timestamp(segment.end)}：{text}")
        return "\n".join(lines)

    try:
        import whisper
    except ImportError as exc:
        raise RuntimeError(
            "视频语音转文字需要安装 faster-whisper 或 openai-whisper。"
        ) from exc

    model = whisper.load_model(model_name)
    result = model.transcribe(str(audio_path), language="zh")
    lines = []
    for segment in result.get("segments", []):
        text = str(segment.get("text", "")).strip()
        if text:
            lines.append(
                f"- {format_timestamp(float(segment.get('start', 0)))} - "
                f"{format_timestamp(float(segment.get('end', 0)))}：{text}"
            )
    return "\n".join(lines)


def format_timestamp(seconds: float) -> str:
    """Format seconds as HH:MM:SS."""

    total = max(0, int(seconds))
    hours, remainder = divmod(total, 3600)
    minutes, secs = divmod(remainder, 60)
    return f"{hours:02d}:{minutes:02d}:{secs:02d}"


def extract_video(path: Path) -> str:
    """Extract speech transcript and frame OCR from a video."""

    ffmpeg = require_ffmpeg()
    interval = max(1, int(os.environ.get("VIDEO_FRAME_INTERVAL_SECONDS", "10")))
    max_frames = max(1, int(os.environ.get("VIDEO_MAX_KEYFRAMES", "120")))

    with tempfile.TemporaryDirectory(prefix="kb_video_") as temp_dir:
        temp_path = Path(temp_dir)
        audio_path = temp_path / "audio.wav"
        frame_pattern = str(temp_path / "frame_%05d.jpg")

        run_command([
            ffmpeg,
            "-y",
            "-i",
            str(path),
            "-vn",
            "-ac",
            "1",
            "-ar",
            "16000",
            str(audio_path),
        ])

        transcript = transcribe_audio(audio_path)

        frame_ocr_lines: list[str] = []
        try:
            run_command([
                ffmpeg,
                "-y",
                "-i",
                str(path),
                "-vf",
                f"fps=1/{interval}",
                "-frames:v",
                str(max_frames),
                frame_pattern,
            ])
            frames = sorted(temp_path.glob("frame_*.jpg"))
            for index, frame in enumerate(frames):
                ocr_text = extract_image(frame).strip()
                if ocr_text:
                    frame_ocr_lines.append(
                        f"### {format_timestamp(index * interval)}\n{ocr_text}"
                    )
        except Exception as exc:  # noqa: BLE001 - frame OCR is useful but optional.
            frame_ocr_lines.append(f"关键帧 OCR 未完成：{exc}")

    parts = [
        "## 视频语音转文字",
        transcript or "未识别到可用语音文字。",
        "",
        "## 视频画面文字 OCR",
        "\n\n".join(frame_ocr_lines) or "未识别到画面文字。",
    ]
    return "\n".join(parts)


def extract_file(path: Path) -> str:
    """Extract text from one supported file."""

    extension = path.suffix.lower()
    if extension not in SUPPORTED_EXTENSIONS:
        raise ValueError(f"不支持的文件类型：{extension}")

    if extension in {".md", ".txt", ".csv"}:
        return read_text_file(path)
    if extension == ".docx":
        return extract_docx(path)
    if extension == ".pdf":
        return extract_pdf(path)
    if extension == ".xlsx":
        return extract_xlsx(path)
    if extension == ".pptx":
        return extract_pptx(path)
    if extension in {".png", ".jpg", ".jpeg", ".webp", ".bmp"}:
        return extract_image(path)
    if extension in VIDEO_EXTENSIONS:
        return extract_video(path)

    raise ValueError(f"不支持的文件类型：{extension}")


def build_payload(path: Path) -> dict[str, Any]:
    """Build the JSON response consumed by the Node backend."""

    content = extract_file(path).strip()
    return {
        "ok": True,
        "file": str(path),
        "extension": path.suffix.lower(),
        "characters": len(content),
        "content": content,
    }


def parse_args() -> argparse.Namespace:
    """Parse CLI arguments."""

    parser = argparse.ArgumentParser(description="Extract text from a document file.")
    parser.add_argument("file", type=Path)
    return parser.parse_args()


def main() -> int:
    """Run the extractor and print JSON to stdout."""

    args = parse_args()
    try:
        payload = build_payload(args.file)
    except Exception as exc:  # noqa: BLE001 - CLI must return structured errors.
        print(
            json.dumps(
                {
                    "ok": False,
                    "file": str(args.file),
                    "error": str(exc),
                },
                ensure_ascii=False,
            ),
            file=sys.stdout,
        )
        return 1

    print(json.dumps(payload, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
