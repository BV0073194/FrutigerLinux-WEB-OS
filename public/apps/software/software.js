window.softwareApp = (function () {
  let softwareList = [];

  async function loadSoftware(grid) {
    const res = await fetch("/api/software");
    softwareList = await res.json();
    renderSoftware(grid, softwareList);
  }

  function renderSoftware(grid, list) {
    grid.innerHTML = "";

    if (!list.length) {
      grid.innerHTML = `<div class="empty">No software found.</div>`;
      return;
    }

    list.forEach((item) => {
      const tile = document.createElement("div");
      tile.className = "softwareTile";

      tile.innerHTML = `
        <div class="softwareIcon">⬇️</div>
        <div class="softwareName">${item.name}</div>
        <div class="softwareVersion">v${item.version}</div>
        <div class="softwareSHA">${item.sha.slice(0, 16)}...</div>
        <button class="downloadBtn" data-file="${item.file}">
          Download
        </button>
      `;

      grid.appendChild(tile);
    });
  }

  function init(root) {
    const grid = root.querySelector("#softwareGrid");
    const searchInput = root.querySelector("#searchInput");

    if (!grid || !searchInput) return;

    // Clear old event listeners by cloning element
    const newGrid = grid.cloneNode(true);
    grid.parentNode.replaceChild(newGrid, grid);

    newGrid.addEventListener("click", (e) => {
      const btn = e.target.closest(".downloadBtn");
      if (!btn) return;
      const file = btn.dataset.file;
      window.location = `/download/software/${file}`;
    });

    searchInput.addEventListener("input", () => {
      const query = searchInput.value.toLowerCase();
      const filtered = softwareList.filter((s) =>
        s.name.toLowerCase().includes(query)
      );
      renderSoftware(newGrid, filtered);
    });

    loadSoftware(newGrid);
  }

  // Auto-run on normal page load
  document.addEventListener("DOMContentLoaded", () => {
    const page = document.querySelector(".page");
    if (page && page.querySelector("#softwareGrid")) {
      init(page);
    }
  });

  return { init };
})();