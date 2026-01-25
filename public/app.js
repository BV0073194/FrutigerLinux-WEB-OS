// ==========================
// GLOBALS
// ==========================
const startBtn = document.getElementById("startBtn");
const startMenu = document.getElementById("startMenu");
const closeStart = document.getElementById("closeStart");
const windowContainer = document.getElementById("windowContainer");

let zIndexCounter = 1;
var loadedModules = {};

// helper: convert "/apps/software" => "software"
function getAppKey(app) {
  return app.replace("/apps/", "");
}

// ==========================
// APP RULES
// ==========================
var appRules = {};

// ==========================
// COMMUNITY APPS LOADER
// ==========================
async function loadCommunityApps() {
  try {
    const res = await fetch("/api/apps");
    const apps = await res.json();

    apps.forEach(app => {
      appRules[app.name] = app.rules;
    });
  } catch (err) {
    console.warn("Failed to load community apps:", err);
  }
}

// run loader
loadCommunityApps();

// ==========================
// START MENU
// ==========================
function toggleStart() {
  startMenu.style.display = startMenu.style.display === "block" ? "none" : "block";
}

startBtn.addEventListener("click", toggleStart);
closeStart.addEventListener("click", () => (startMenu.style.display = "none"));

document.addEventListener("click", (e) => {
  if (!startMenu.contains(e.target) && !startBtn.contains(e.target)) {
    startMenu.style.display = "none";
  }
});

// ==========================
// APP MANAGEMENT
// ==========================
const appInstances = {};
const menuTimers = {}; // <-- PER-APP TIMER
let activeStackApp = null; // prevents hover flicker

async function getAppRules(app) {
  if (appRules[app]) {
    console.log("App rules found:", appRules[app]);
    return appRules[app];
  } else {
    console.log("Fetching app rules from:", `${app}`);
    try {
      const res = await fetch(`${app}`);
      if (!res.ok) throw new Error('Network response was not ok');
      const rules = await res.json();
      console.log("Fetched app rules:", rules);
      return rules;
    } catch (error) {
      console.error("Failed to fetch app rules:", error);
      return {
        maxInstances: 1,
        stack: false,
        resizable: true,
        minimize: true,
        maximize: true,
        taskbarIcon: false
      };
    }
  }
}

function openApp(appKey) {
  const appPath = "/apps/" + appKey;
  const rules = getAppRules(`${appPath}/app.properties.json`);

  appInstances[appPath] = appInstances[appPath] || [];
  const instances = appInstances[appPath];

  // enforce max instances (unless -1)
  if (rules.maxInstances !== -1 && instances.length >= rules.maxInstances) {
    const winToFocus = instances[0];
    focusWindow(winToFocus);
    return;
  }

  const win = document.createElement("div");
  win.className = "window";
  win.style.top = "70px";
  win.style.left = "70px";
  win.style.zIndex = ++zIndexCounter;

  win.dataset.app = appPath;
  win.dataset.appKey = appKey;
  win.dataset.resizable = rules.resizable;
  win.dataset.minimize = rules.minimize;
  win.dataset.maximize = rules.maximize;
  win.dataset.minimized = "false";

  win.innerHTML = `
    <div class="window-header">
      <div class="window-title">${appKey.toUpperCase()}</div>
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

  // bring to front
  win.addEventListener("mousedown", () => {
    win.style.zIndex = ++zIndexCounter;
  });

  // load app content into window body
  fetch(`${appPath}/index.html`)
    .then((r) => r.text())
    .then((html) => {
      win.querySelector(".window-body").innerHTML = html;
      if (!loadedModules[appPath]) {
        return fetch(`/api/apps/${appKey}`)
          .then(r => r.json())
          .then(jsFiles => {
            const loadPromises = jsFiles.map(file => import(`${appPath}/${file}`));
            return Promise.all(loadPromises);
          })
          .then(modules => {
            loadedModules[appPath] = modules;
            // Call init for known apps
            const softwareModule = modules.find(m => m.softwareApp);
            if (softwareModule) {
              softwareModule.softwareApp.init(win.querySelector(".window-body"));
            }
            const osModule = modules.find(m => m.init);
            if (osModule) {
              osModule.init();
            }
          })
          .catch(err => console.error('Failed to load JS modules:', err));
      } else {
        // Already loaded, call init
        const softwareModule = loadedModules[appPath].find(m => m.softwareApp);
        if (softwareModule) {
          softwareModule.softwareApp.init(win.querySelector(".window-body"));
        }
        const osModule = loadedModules[appPath].find(m => m.init);
        if (osModule) {
          osModule.init();
        }
      }
    })
    .catch(() => {
      win.querySelector(".window-body").innerHTML = `<div class="aero-card"><p>Failed to load app.</p></div>`;
    });

  // window controls
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
  updateTaskbarIndicator(appPath);
}

function focusWindow(win) {
  win.dataset.minimized = "false";
  win.style.display = "block";
  win.style.zIndex = ++zIndexCounter;
}

function closeWindow(win) {
  const appPath = win.dataset.app;
  appInstances[appPath] = appInstances[appPath].filter((w) => w !== win);
  win.remove();
  updateTaskbarIndicator(appPath);
  if (loadedModules[appPath]) {
    delete loadedModules[appPath];
  }
}

function minimizeWindow(win) {
  win.dataset.minimized = "true";
  win.style.display = "none";
  updateTaskbarIndicator(win.dataset.app);
}

function updateTaskbarIndicator(appPath) {
  const appKey = getAppKey(appPath);
  const rules = getAppRules(appKey);
  if (!rules.stack) return;

  const launcher = document.querySelector(`[data-app="${appKey}"]`);
  if (!launcher) return;

  const instances = appInstances[appPath] || [];
  const hasAny = instances.length > 0;

  let bar = launcher.querySelector(".taskbar-indicator");

  if (!bar && hasAny) {
    bar = document.createElement("div");
    bar.className = "taskbar-indicator";
    launcher.appendChild(bar);
  }

  if (bar) {
    bar.style.display = hasAny ? "block" : "none";
    bar.style.height = instances.length > 1 ? "4px" : "2px";
  }
}

// =============================
// LIVE PREVIEW (Windows-style)
// =============================
async function createLivePreview(win) {
  const preview = document.createElement("div");
  preview.className = "stack-preview";

  const inner = document.createElement("div");
  inner.className = "stack-preview-inner";

  const canvas = await html2canvas(win, { backgroundColor: null });
  const img = document.createElement("img");
  img.src = canvas.toDataURL("image/png");
  img.className = "stack-preview-img";
  inner.appendChild(img);

  preview.appendChild(inner);
  return preview;
}

async function openStackMenu(appPath, icon) {
  // remove any other app's stack menu
  document.querySelectorAll(".stack-menu").forEach(m => m.remove());

  const instances = appInstances[appPath] || [];
  if (instances.length === 0) return;

  const menu = document.createElement("div");
  menu.className = "stack-menu";

  const row = document.createElement("div");
  row.className = "stack-items-row";
  menu.appendChild(row);

  for (let i = 0; i < instances.length; i++) {
    const win = instances[i];

    const item = document.createElement("div");
    item.className = "stack-item";

    item.innerHTML = `
      <div class="stack-left">
        <span class="stack-icon">⬇️</span>
        <span class="stack-title">${getAppKey(appPath).toUpperCase()} (${i + 1})</span>
        <button class="stack-close">✕</button>
      </div>
    `;

    const closeBtn = item.querySelector(".stack-close");
    const preview = await createLivePreview(win);

    item.appendChild(preview);

    item.addEventListener("click", () => {
      focusWindow(win);
      menu.remove();
    });

    closeBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      closeWindow(win);
      menu.remove();
    });

    row.appendChild(item);
  }

  document.body.appendChild(menu);

  requestAnimationFrame(() => {
    const rect = icon.getBoundingClientRect();
    const menuRect = menu.getBoundingClientRect();
    const taskbarHeight = 54;

    let top = rect.top - menuRect.height - 10;
    let left = rect.left + rect.width / 2 - menuRect.width / 2;

    if (top < 0) {
      top = rect.bottom + 10;
    }

    const maxLeft = window.innerWidth - menuRect.width - 10;
    if (left > maxLeft) left = maxLeft;
    if (left < 10) left = 10;

    const bottom = top + menuRect.height;
    if (bottom > window.innerHeight - taskbarHeight) {
      top = window.innerHeight - taskbarHeight - menuRect.height - 10;
    }

    menu.style.top = `${top}px`;
    menu.style.left = `${left}px`;
  });

  menu.addEventListener("mouseenter", () => {
    clearTimeout(menuTimers[getAppKey(appPath)]);
    activeStackApp = getAppKey(appPath);
  });

  menu.addEventListener("mouseleave", () => {
    const key = getAppKey(appPath);
    menuTimers[key] = setTimeout(() => {
      menu.remove();
      activeStackApp = null;
    }, 250);
  });
}

// ==========================
// WINDOWS
// ==========================
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

// clock
setInterval(() => {
  const clock = document.getElementById("clock");
  const now = new Date();
  const hours = String(now.getHours()).padStart(2, "0");
  const mins = String(now.getMinutes()).padStart(2, "0");
  clock.textContent = `${hours}:${mins}`;
}, 1000);

// DOUBLE CLICK LAUNCHER SETUP
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

  // hover menu only for launcher
  btn.addEventListener("mouseenter", () => {
    const appKey = btn.dataset.app;
    const rules = getAppRules(appKey);
    if (!rules.stack) return;

    activeStackApp = appKey;
    clearTimeout(menuTimers[appKey]);
    openStackMenu("/apps/" + appKey, btn);
  });

  btn.addEventListener("mouseleave", () => {
    const appKey = btn.dataset.app;
    menuTimers[appKey] = setTimeout(() => {
      if (activeStackApp === appKey) {
        const menu = document.querySelector(".stack-menu");
        if (menu && !menu.matches(":hover")) {
          menu.remove();
          activeStackApp = null;
        }
      }
    }, 250);
  });
});
