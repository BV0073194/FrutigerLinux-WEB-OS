// ==========================
// GLOBALS
// ==========================
const startBtn = document.getElementById("startBtn");
const startMenu = document.getElementById("startMenu");
const closeStart = document.getElementById("closeStart");
const windowContainer = document.getElementById("windowContainer");
const taskbarIcons = document.querySelector(".taskbar-icons");

let zIndexCounter = 1;

// ==========================
// APP RULES (built-in apps)
// ==========================
const appRules = {
  software: {
    maxInstances: -1,
    stack: true,
    resizable: true,
    minimize: true,
    maximize: true,
    taskbarIcon: false
  },
  os: {
    maxInstances: 2,
    stack: false,
    resizable: false,
    minimize: false,
    maximize: false,
    taskbarIcon: true
  },
  about: {
    maxInstances: 1,
    stack: true,
    resizable: true,
    minimize: true,
    maximize: false,
    taskbarIcon: false
  }
};

// Track instances
const appInstances = {};
const menuTimers = {};

// ==========================
// HELPER: FETCH APPS + CONFIG
// ==========================
let userConfig = { installedApps: {} };
let communityApps = [];

async function loadApps() {
  const appsRes = await fetch("/api/apps");
  communityApps = await appsRes.json();

  const configRes = await fetch("/api/user-config");
  userConfig = await configRes.json();

  // ensure config exists
  if (!userConfig.installedApps) userConfig.installedApps = {};

  // Add built-in apps
  addLauncher("software", "Software");
  addLauncher("os", "OS");
  addLauncher("about", "About");

  // Add community apps
  communityApps.forEach((app) => {
    const appId = app.id;
    const appName = app.name || app.id;

    // if not installed, ask user once
    if (!userConfig.installedApps[appId]?.asked) {
      askInstall(appId, appName);
    } else {
      // install based on saved config
      const installed = userConfig.installedApps[appId].installed;
      const addedTo = userConfig.installedApps[appId].addedTo;
      if (installed) {
        addLauncher(appId, appName, addedTo);
      }
    }
  });

  setupLaunchers();
}

// ==========================
// ASK USER WHERE TO ADD APP
// ==========================
async function askInstall(appId, appName) {
  const choice = prompt(
    `Install "${appName}"?\nType: start / taskbar / both\n(leave blank to skip)`
  );

  const addedTo = (choice || "").toLowerCase();

  if (!["start", "taskbar", "both"].includes(addedTo)) {
    userConfig.installedApps[appId] = { installed: false, asked: true };
    return;
  }

  userConfig.installedApps[appId] = {
    installed: true,
    asked: true,
    addedTo
  };

  await fetch("/api/install", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ appId, addedTo })
  });

  addLauncher(appId, appName, addedTo);
}

// ==========================
// CREATE LAUNCHERS
// ==========================
function addLauncher(appId, label, addedTo = "start") {
  // Start menu launcher
  if (addedTo === "start" || addedTo === "both") {
    const btn = document.createElement("button");
    btn.className = "start-app-btn";
    btn.dataset.app = appId;
    btn.textContent = label;
    startMenu.appendChild(btn);
  }

  // Taskbar launcher
  if (addedTo === "taskbar" || addedTo === "both") {
    const icon = document.createElement("button");
    icon.className = "task-icon";
    icon.dataset.app = appId;
    icon.textContent = label[0].toUpperCase();
    taskbarIcons.appendChild(icon);
  }
}

// ==========================
// START MENU TOGGLE
// ==========================
function toggleStart() {
  startMenu.style.display =
    startMenu.style.display === "block" ? "none" : "block";
}

startBtn.addEventListener("click", toggleStart);
closeStart.addEventListener("click", () => (startMenu.style.display = "none"));

document.addEventListener("click", (e) => {
  if (!startMenu.contains(e.target) && !startBtn.contains(e.target)) {
    startMenu.style.display = "none";
  }
});

// ==========================
// APP WINDOW MANAGEMENT
// ==========================
function openApp(app) {
  const rules = appRules[app] || {
    maxInstances: 1,
    stack: false,
    resizable: true,
    minimize: true,
    maximize: true,
    taskbarIcon: false
  };

  appInstances[app] = appInstances[app] || [];
  const instances = appInstances[app];

  if (rules.maxInstances !== -1 && instances.length >= rules.maxInstances) {
    focusWindow(instances[0]);
    return;
  }

  const win = document.createElement("div");
  win.className = "window";
  win.style.top = "70px";
  win.style.left = "70px";
  win.style.zIndex = ++zIndexCounter;

  win.dataset.app = app;
  win.dataset.resizable = rules.resizable;
  win.dataset.minimize = rules.minimize;
  win.dataset.maximize = rules.maximize;

  win.innerHTML = `
    <div class="window-header">
      <div class="window-title">${app.toUpperCase()}</div>
      <div class="window-controls">
        <button class="win-btn" data-action="minimize">▁</button>
        <button class="win-btn" data-action="maximize">▢</button>
        <button class="win-btn" data-action="close">✕</button>
      </div>
    </div>
    <div class="window-body">
      <div class="loading">Loading...</div>
    </div>
    <div class="resize-handle"></div>
  `;

  windowContainer.appendChild(win);
  instances.push(win);

  win.addEventListener("mousedown", () => {
    win.style.zIndex = ++zIndexCounter;
  });

  fetch(`/${app}.html`)
    .then((r) => r.text())
    .then((html) => {
      win.querySelector(".window-body").innerHTML = html;
    })
    .catch(() => {
      win.querySelector(".window-body").innerHTML = `<div class="aero-card"><p>Failed to load app.</p></div>`;
    });

  // Controls
  win.querySelector("[data-action='close']").addEventListener("click", () => {
    closeWindow(win);
  });

  const minBtn = win.querySelector("[data-action='minimize']");
  if (rules.minimize) {
    minBtn.addEventListener("click", () => minimizeWindow(win));
  } else {
    minBtn.style.display = "none";
  }

  const maxBtn = win.querySelector("[data-action='maximize']");
  if (rules.maximize) {
    maxBtn.addEventListener("click", () => maximizeWindow(win));
  } else {
    maxBtn.style.display = "none";
  }

  if (rules.resizable) {
    makeResizable(win);
  } else {
    win.querySelector(".resize-handle").style.display = "none";
  }

  makeDraggable(win);
}

function focusWindow(win) {
  win.dataset.minimized = "false";
  win.style.display = "block";
  win.style.zIndex = ++zIndexCounter;
}

function closeWindow(win) {
  const app = win.dataset.app;
  appInstances[app] = appInstances[app].filter((w) => w !== win);
  win.remove();
}

function minimizeWindow(win) {
  win.dataset.minimized = "true";
  win.style.display = "none";
}

function maximizeWindow(win) {
  if (win.classList.contains("maximized")) {
    win.classList.remove("maximized");
    win.style.width = "";
    win.style.height = "";
    win.style.top = "70px";
    win.style.left = "70px";
  } else {
    win.classList.add("maximized");
    win.style.top = "0";
    win.style.left = "0";
    win.style.width = "100%";
    win.style.height = "calc(100% - 54px)";
  }
}

// ==========================
// Drag & Resize
// ==========================
function makeDraggable(win) {
  const header = win.querySelector(".window-header");
  let dragging = false;
  let offsetX, offsetY;

  header.addEventListener("mousedown", (e) => {
    dragging = true;
    offsetX = e.clientX - win.offsetLeft;
    offsetY = e.clientY - win.offsetTop;
    header.style.cursor = "grabbing";
  });

  document.addEventListener("mousemove", (e) => {
    if (!dragging) return;
    win.style.left = `${e.clientX - offsetX}px`;
    win.style.top = `${e.clientY - offsetY}px`;
  });

  document.addEventListener("mouseup", () => {
    dragging = false;
    header.style.cursor = "grab";
  });
}

function makeResizable(win) {
  const handle = win.querySelector(".resize-handle");
  let resizing = false;
  let startX, startY, startWidth, startHeight;

  handle.addEventListener("mousedown", (e) => {
    resizing = true;
    startX = e.clientX;
    startY = e.clientY;
    startWidth = win.offsetWidth;
    startHeight = win.offsetHeight;
    e.preventDefault();
  });

  document.addEventListener("mousemove", (e) => {
    if (!resizing) return;
    win.style.width = `${startWidth + (e.clientX - startX)}px`;
    win.style.height = `${startHeight + (e.clientY - startY)}px`;
  });

  document.addEventListener("mouseup", () => {
    resizing = false;
  });
}

// ==========================
// CLOCK
// ==========================
setInterval(() => {
  const clock = document.getElementById("clock");
  const now = new Date();
  const hours = String(now.getHours()).padStart(2, "0");
  const mins = String(now.getMinutes()).padStart(2, "0");
  clock.textContent = `${hours}:${mins}`;
}, 1000);

// ==========================
// DOUBLE CLICK LAUNCHERS
// ==========================
function setupLaunchers() {
  document.querySelectorAll("[data-app]").forEach((btn) => {
    let clickCount = 0;
    let timer = null;

    btn.addEventListener("click", () => {
      clickCount++;

      if (clickCount === 1) {
        timer = setTimeout(() => {
          clickCount = 0;
        }, 250);
      }

      if (clickCount === 2) {
        clearTimeout(timer);
        clickCount = 0;
        openApp(btn.dataset.app);
        startMenu.style.display = "none";
      }
    });
  });
}

// ==========================
// INITIALIZE
// ==========================
loadApps();
