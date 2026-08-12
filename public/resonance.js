const canvas = document.querySelector("#resonance-canvas");

if (canvas && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
  const context = canvas.getContext("2d", { alpha: true });

  if (context) {
    const pointer = {
      x: window.innerWidth * 0.56,
      y: window.innerHeight * 0.45,
    };
    const smooth = { ...pointer };
    const particles = Array.from({ length: 42 }, (_, index) => ({
      angle: (Math.PI * 2 * index) / 42,
      orbit: 120 + (index % 5) * 42,
      speed: 0.13 + (index % 4) * 0.026,
      size: 0.55 + (index % 3) * 0.33,
      phase: index * 0.67,
    }));
    let width = 0;
    let height = 0;
    let ratio = 1;
    let animationFrame = 0;
    const startedAt = performance.now();

    const resize = () => {
      ratio = Math.min(window.devicePixelRatio || 1, 2);
      width = window.innerWidth;
      height = window.innerHeight;
      canvas.width = Math.floor(width * ratio);
      canvas.height = Math.floor(height * ratio);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
    };

    const drawField = (seconds) => {
      const originX = width * 0.57 + (smooth.x - width * 0.5) * 0.055;
      const originY = height * 0.44 + (smooth.y - height * 0.45) * 0.04;
      const tilt = (smooth.x / Math.max(width, 1) - 0.5) * 0.16;

      context.clearRect(0, 0, width, height);

      for (let ring = 0; ring < 5; ring += 1) {
        context.save();
        context.translate(originX, originY);
        context.rotate(tilt + seconds * (0.045 + ring * 0.012) + ring * 0.5);
        context.scale(1, 0.32 + ring * 0.052);
        context.strokeStyle = ring === 0
          ? "rgba(210, 238, 225, 0.2)"
          : "rgba(117, 185, 157, 0.13)";
        context.lineWidth = 1;
        context.beginPath();
        context.ellipse(0, 0, 72 + ring * 41, 72 + ring * 41, 0, 0, Math.PI * 2);
        context.stroke();
        context.restore();
      }

      context.strokeStyle = "rgba(148, 208, 181, 0.24)";
      context.lineWidth = 1;
      context.beginPath();
      for (let point = 0; point <= 110; point += 1) {
        const progress = point / 110;
        const x = width * (0.18 + progress * 0.66);
        const falloff = Math.abs(progress - 0.5) * 2;
        const arc = Math.pow(1 - falloff, 1.35);
        const wave = Math.sin(progress * Math.PI * 4 + seconds * 0.9) * 13;
        const y = originY + 118 - arc * 155 + wave;
        if (point === 0) {
          context.moveTo(x, y);
        } else {
          context.lineTo(x, y);
        }
      }
      context.stroke();

      for (const particle of particles) {
        const rotation = particle.angle + seconds * particle.speed;
        const radius = particle.orbit + Math.sin(seconds * 0.52 + particle.phase) * 12;
        const x = originX + Math.cos(rotation) * radius;
        const y = originY + Math.sin(rotation) * radius * 0.34;
        context.fillStyle = "rgba(205, 234, 221, 0.42)";
        context.beginPath();
        context.arc(x, y, particle.size, 0, Math.PI * 2);
        context.fill();
      }

      context.fillStyle = "rgba(226, 246, 235, 0.82)";
      context.beginPath();
      context.arc(originX, originY, 4.4, 0, Math.PI * 2);
      context.fill();
    };

    const frame = (now) => {
      smooth.x += (pointer.x - smooth.x) * 0.075;
      smooth.y += (pointer.y - smooth.y) * 0.075;
      drawField((now - startedAt) / 1000);
      animationFrame = requestAnimationFrame(frame);
    };

    window.addEventListener("pointermove", (event) => {
      pointer.x = event.clientX;
      pointer.y = event.clientY;
    }, { passive: true });
    window.addEventListener("resize", resize, { passive: true });

    resize();
    animationFrame = requestAnimationFrame(frame);

    window.addEventListener("pagehide", () => cancelAnimationFrame(animationFrame), { once: true });
  }
}
