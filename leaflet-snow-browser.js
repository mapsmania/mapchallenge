// ---- Leaflet Snow Browser Version (Layered + Drift) ----
// Works with <script> and global L (Leaflet)

(function () {
  if (!window.L) {
    console.error("Leaflet.Snow: Leaflet (window.L) not found.");
    return;
  }

  L.SnowLayer = L.Layer.extend({
    initialize: function (options = {}) {
      L.setOptions(this, options);

      // Layers definition
      this._layers = options.layers || [
        { density: 50, speed: 0.5, size: 1.5, drift: 0.3 },
        { density: 35, speed: 1.0, size: 2.0, drift: 0.5 },
        { density: 20, speed: 1.8, size: 3.0, drift: 1.0 }
      ];

      this._particles = [];
    },

    onAdd: function (map) {
      this._map = map;
      this._canvas = L.DomUtil.create("canvas", "leaflet-snow-canvas");
      this._ctx = this._canvas.getContext("2d");

      map.getPanes().overlayPane.appendChild(this._canvas);
      map.on("moveend zoomend resize", this._reset, this);

      this._reset();
      this._animationFrame = requestAnimationFrame(
        this._animate.bind(this)
      );
    },

    onRemove: function (map) {
      cancelAnimationFrame(this._animationFrame);
      L.DomUtil.remove(this._canvas);
      map.off("moveend zoomend resize", this._reset, this);
    },

    _reset: function () {
      const size = this._map.getSize();
      this._canvas.width = size.x;
      this._canvas.height = size.y;

      this._particles = [];

      // Create snow particles for each layer
      this._layers.forEach(layer => {
        for (let i = 0; i < layer.density; i++) {
          this._particles.push({
            x: Math.random() * size.x,
            y: Math.random() * size.y,
            r: layer.size,
            speed: layer.speed,
            drift: layer.drift
          });
        }
      });
    },

    _animate: function () {
      const ctx = this._ctx;
      const canvas = this._canvas;
      const parts = this._particles;

      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = this.options.color || "rgba(255,255,255,0.9)";

      for (let p of parts) {
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fill();

        // Motion
        p.y += p.speed * 0.8;
        p.x += p.drift * 0.3; // sideways drift

        // Reset particle when off-screen
        if (p.y > canvas.height) p.y = -10;
        if (p.x > canvas.width) p.x = -10;
        if (p.x < -10) p.x = canvas.width + 10;
      }

      this._animationFrame = requestAnimationFrame(
        this._animate.bind(this)
      );
    }
  });

  L.snow = function (options) {
    return new L.SnowLayer(options);
  };
})();
