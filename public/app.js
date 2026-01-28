// ==========================
// GLOBALS
// ==========================
const startBtn = document.getElementById("startBtn");
const startMenu = document.getElementById("startMenu");
const closeStart = document.getElementById("closeStart");
const windowContainer = document.getElementById("windowContainer");
const clock = document.getElementById("clock");
const startPin = document.querySelector(".start-menu-grid");
const taskbarIcons = document.querySelector(".taskbar-icons");

let zIndexCounter = 1;
var loadedModules = {};
let isRestoringState = false; // Flag to prevent saves during restoration
let lastSaveTime = 0; // Track last save to prevent spam
let restorationPromise = null; // Track ongoing restoration

let domReady = false;
const domReadyQueue = [];

document.addEventListener("DOMContentLoaded", () => {
  domReady = true;
  domReadyQueue.forEach(fn => fn());
  domReadyQueue.length = 0;
});

function whenDomReady(fn) {
  domReady ? fn() : domReadyQueue.push(fn);
}


// ==========================
// SOCKET.IO
// ==========================
const socket = io();
let socketId = null;

socket.on("connect", () => {
  socketId = socket.id;
});

socket.on("uac:required", ({ command, risks }) => {
  showUAC(risks);
});

// ==========================
// PINNED LAUNCHER HELPER ✅
// ==========================
function createStartMenuPin(appName, iconSrc) {
  if (startPin.querySelector(`[data-app="${appName}"]`)) return;
  const btn = document.createElement("button");
  btn.className = "task-icon launcher";
  btn.dataset.app = appName;
  btn.title = appName;

  btn.innerHTML = `
    <img src="${iconSrc}" 
         alt="${appName}" 
         class="app-icon"
         style="width:100%;height:100%;object-fit:contain;"
         onload="validateIconSize(this)">
  `;

  startPin.appendChild(btn);
}

function createTaskbarPin(appKey, iconSrc) {
  if (taskbarIcons.querySelector(`[data-app="${appKey}"]`)) return;
  const btn = document.createElement("button");
  btn.className = "task-icon launcher";
  btn.dataset.app = appKey;
  btn.title = appKey;

  btn.innerHTML = `
    <img src="${iconSrc}"
         alt="${appKey}"
         class="app-icon"
         style="width:100%;height:100%;object-fit:contain;"
         onload="validateIconSize(this)">
  `;

  taskbarIcons.appendChild(btn);
}

// ==========================
// STATE SAVE / LOAD
// ==========================
function saveDesktopState(useBeacon = false) {
  // Don't save during restoration
  if (isRestoringState) {
    return;
  }
  
  // Prevent saves more frequent than 100ms (debounce rapid calls)
  /*const now = Date.now();
  if (!useBeacon && now - lastSaveTime < 100) {
    return;
  }
  lastSaveTime = now;*/
  
  const windows = [];
  
  const allWindows = document.querySelectorAll('.window');
  
  allWindows.forEach((win, index) => {
    const appKey = win.dataset.appKey;
    const instanceId = win.dataset.instanceId;
    
    const rules = appRules[appKey] || {};
    const windowData = {
      appKey: appKey,
      instanceId: instanceId,
      top: win.style.top,
      left: win.style.left,
      width: win.style.width,
      height: win.style.height,
      minimized: win.dataset.minimized === 'true',
      maximized: win.classList.contains('maximized'),
      zIndex: parseInt(win.style.zIndex) || 1,
      preview: win.dataset.minimized === 'true' ? win.storedPreview : null
    };
    
    // Get session state if app supports it
    if (rules.sessionState && win._getAppSessionState) {
      try {
        const sessionState = win._getAppSessionState();
        windowData.sessionState = sessionState;
      } catch (e) {
        console.warn('Failed to get session state for', appKey, e);
      }
    } else if (rules.sessionState) {
      console.warn(`    App ${appKey} has sessionState enabled but no _getAppSessionState function`);
    }
    
    windows.push(windowData);
  });

  const payload = JSON.stringify({ windows, zIndexCounter });
  
  if (useBeacon) {
    // Use sendBeacon for synchronous save during page unload
    navigator.sendBeacon('/api/save-state', new Blob([payload], { type: 'application/json' }));
  } else {
    // Use regular fetch for async saves
    fetch('/api/save-state', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: payload
    }).catch(err => console.error('Failed to save state:', err));
  }
}

async function loadDesktopState() {
  // Set restoration flag IMMEDIATELY to block any pending saves
  if (isRestoringState) {
    console.log('⏸️ Restoration already in progress, skipping');
    return;
  }
  isRestoringState = true;
  
  // If restoration is already in progress, wait for it to complete
  if (restorationPromise) {
    console.log('⏸️ Restoration promise exists, waiting...');
    await restorationPromise;
    console.log('✅ Previous restoration completed');
    isRestoringState = false;
    return;
  }
  
  // Create promise for this restoration
  restorationPromise = (async () => {
    try {
      // Clear any pending save timers
      clearTimeout(saveDebounceTimer);
      
      const res = await fetch('/api/load-state');
      if (!res.ok) {
        console.warn('Failed to fetch state:', res.status);
        return;
      }
      const state = await res.json();
      
      if (!state.windows || state.windows.length === 0) {
        return;
      }
      
      zIndexCounter = state.zIndexCounter || 1;
      
      // Clear any existing windows to prevent duplicates from rapid refreshes
      document.querySelectorAll('.window').forEach(win => {
        win.remove();
      });
      // Clear instance tracking
      Object.keys(appInstances).forEach(key => {
        appInstances[key] = [];
      });

      for (const winState of state.windows) {
        try {
          await openApp(winState.appKey, true, winState.sessionState); // pass restore flag and session state
          
          // Wait a bit for the window to be fully created
          await new Promise(resolve => setTimeout(resolve, 150));
      
        const win = appInstances[winState.appKey]?.at(-1);
        if (!win) {
          console.warn('Failed to restore window for app:', winState.appKey);
          continue;
        }

        // Restore window properties
        Object.assign(win.style, {
          top: winState.top,
          left: winState.left,
          width: winState.width,
          height: winState.height,
          zIndex: winState.zIndex
        });

        win.dataset.minimized = winState.minimized ? "true" : "false";
        if (winState.minimized) {
          win.style.display = "none";
          win.storedPreview = winState.preview;
        }
        if (winState.maximized) win.classList.add("maximized");
        updateTaskbarIndicator(winState.appKey);
      } catch (err) {
        console.error('Error restoring window:', winState.appKey, err);
      }
    }
  } catch (err) {
    console.error('Failed to load desktop state:', err);
  } finally {
    isRestoringState = false;
    restorationPromise = null;
  }
  })();
  
  return restorationPromise;
}

// ==========================
// APP RULES
// ==========================
var appRules = {};

// ==========================
// COMMUNITY APPS LOADER ✅
// ==========================
const appFolderMap = {}; // Maps appname -> folder name

async function loadCommunityApps() {
  try {
    const res = await fetch("/api/apps");
    const apps = await res.json();

    for (const app of apps) {
      const appName = app.rules.appname || app.folderName; // Use appname from properties or fallback to folder
      const appTitle = app.rules.appTitle || appName; // Use appTitle or fallback to appname
      
      // Map appname to folder for file loading
      appFolderMap[appName] = app.folderName;
      
      // Store rules under appname
      appRules[appName] = app.rules;
      appRules[appName].folderName = app.folderName;
      appRules[appName].appTitle = appTitle;

      // icon detection
      try {
        const html = await (await fetch(`/apps/${encodeURIComponent(app.folderName)}/index.html`)).text();
        const doc = new DOMParser().parseFromString(html, "text/html");
        const ico = doc.querySelector("appico")?.getAttribute("src");
        appRules[appName].icon = ico || `/apps/${encodeURIComponent(app.folderName)}/icon.png`;
      } catch {
        appRules[appName].icon = `/apps/${encodeURIComponent(app.folderName)}/icon.png`;
      }

      // AUTO PIN
      // Start menu pin
      whenDomReady(() => {
        // Start menu pin
        if (app.rules.startPin === true) {
          createStartMenuPin(appName, appRules[appName].icon);
        }

        // Taskbar pin
        if (app.rules.addedTaskBar === true) {
          createTaskbarPin(appName, appRules[appName].icon);
        }
      });

      // existing start menu logic untouched
      if (app.rules.startPin) {
        if (!document.querySelector(`.start-menu-grid [data-app="${appName}"]`)) {
          const tile = document.createElement("button");
          tile.className = "start-tile";
          tile.dataset.app = appName;
          tile.innerHTML = `
            <div class="tile-icon">
              <img src="${appRules[appName].icon}" class="app-icon">
            </div>
            <div class="tile-title">${appTitle}</div>
          `;
          document.querySelector(".start-menu-grid").appendChild(tile);
        }
      }
    }
  } catch (err) {
    console.warn("Failed to load community apps:", err);
  }
}

// boot
loadCommunityApps().then(() => {
  // Wait for DOM to be fully ready before restoring state
  // This ensures all launchers/pins are created first
  whenDomReady(() => {
    // Small delay to ensure all dynamic content is rendered
    setTimeout(() => {
      loadDesktopState();
    }, 100);
  });
});

// Periodic save every 30 seconds
setInterval(() => saveDesktopState(false), 30000);

// Debounced save on input changes
let saveDebounceTimer = null;
function debouncedSave() {
  clearTimeout(saveDebounceTimer);
  saveDebounceTimer = setTimeout(() => {
    if (!isRestoringState) {
      saveDesktopState(false);
    }
  }, 1000);
}

// Listen for input changes in any window to trigger save
document.addEventListener('input', (e) => {
  if (e.target.closest('.window-body')) {
    debouncedSave();
  }
}, true);

// Save when window loses focus
window.addEventListener('blur', () => {
  if (!isRestoringState && document.querySelectorAll('.window').length > 0) {
    saveDesktopState(false);
  }
});

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

async function getAppRules(appKey) {
  // If already cached, return it
  if (appRules[appKey]) {
    return appRules[appKey];
  }
  
  // Get folder name from mapping
  const folderName = appFolderMap[appKey] || appKey;
  const appPath = "/apps/" + encodeURIComponent(folderName) + "/app.properties.json";
  console.log("Fetching app rules from:", appPath);
  try {
    const res = await fetch(appPath);
    if (!res.ok) throw new Error('Network response was not ok');
    const rules = await res.json();
    console.log("Fetched app rules:", rules);
    appRules[appKey] = rules;
    appRules[appKey].folderName = folderName;
    appRules[appKey].appTitle = rules.appTitle || appKey;
    return rules;
  } catch (error) {
    console.error(`Failed to fetch app rules: ${appPath}`, error);
    // Return default rules
    const defaultRules = {
      maxInstances: 1,
      stack: false,
      resizable: true,
      minimize: true,
      maximize: true,
      startPin: false,
      folderName: folderName,
      appTitle: appKey
    };
    appRules[appKey] = defaultRules;
    return defaultRules;
  }
}

// Session state helper function
function setupSessionState(win, body) {
  // Auto-capture function: saves DOM state automatically
  win._getAppSessionState = () => {
    // First check if app has custom save function (removed - use automatic only)
    
    // Auto-capture common state
    const state = {
      inputs: {},
      scrollPosition: { x: body.scrollLeft || 0, y: body.scrollTop || 0 }
    };
    
    // Capture all form inputs
    body.querySelectorAll('input, textarea, select').forEach(element => {
      if (element.id || element.name) {
        const key = element.id || element.name;
        
        if (element.type === 'checkbox' || element.type === 'radio') {
          state.inputs[key] = {
            type: element.type,
            checked: element.checked,
            value: element.value
          };
        } else if (element.tagName === 'SELECT') {
          state.inputs[key] = {
            type: 'select',
            selectedIndex: element.selectedIndex,
            value: element.value
          };
        } else {
          state.inputs[key] = {
            type: element.type || 'text',
            value: element.value
          };
        }
      }
    });
    
    // Capture contenteditable elements
    body.querySelectorAll('[contenteditable="true"]').forEach((element, index) => {
      if (element.id) {
        state.inputs[element.id] = {
          type: 'contenteditable',
          html: element.innerHTML
        };
      } else {
        state.inputs[`contenteditable_${index}`] = {
          type: 'contenteditable',
          html: element.innerHTML
        };
      }
    });
    
    return state;
  };
  
  // Auto-restore function: restores DOM state automatically
  win._restoreAppSessionState = (state) => {
    if (!state) return;
    
    // Auto-restore common state
    setTimeout(() => {
      // Restore form inputs
      if (state.inputs) {
        Object.keys(state.inputs).forEach(key => {
          const element = body.querySelector(`#${key}, [name="${key}"]`);
          if (!element) {
            return;
          }
          
          const inputState = state.inputs[key];
          
          if (inputState.type === 'checkbox' || inputState.type === 'radio') {
            element.checked = inputState.checked;
          } else if (inputState.type === 'select') {
            element.selectedIndex = inputState.selectedIndex;
            element.value = inputState.value;
          } else if (inputState.type === 'contenteditable') {
            element.innerHTML = inputState.html;
          } else {
            element.value = inputState.value;
          }
          
          // Trigger input event for search boxes and reactive fields
          if (element.tagName === 'INPUT' || element.tagName === 'TEXTAREA') {
            element.dispatchEvent(new Event('input', { bubbles: true }));
          }
        });
      }
      
      // Restore scroll position within the window body
      if (state.scrollPosition) {
        body.scrollLeft = state.scrollPosition.x || 0;
        body.scrollTop = state.scrollPosition.y || 0;
      }
    }, 150);
  };
  
  // Don't auto-restore here - it will be done after app initialization
}

async function openApp(appKey, isRestoring = false, sessionState = null) {
  const rules = await getAppRules(appKey);
  const folderName = rules.folderName || appFolderMap[appKey] || appKey;
  const appTitle = rules.appTitle || appKey;
  const appPath = "/apps/" + encodeURIComponent(folderName);

  appInstances[appKey] = appInstances[appKey] || [];
  const instances = appInstances[appKey];

  // enforce max instances (unless -1 or we're restoring from saved state)
  if (!isRestoring && rules.maxInstances !== -1 && instances.length >= rules.maxInstances) {
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
  win.dataset.folderName = folderName;
  win.dataset.resizable = rules.resizable;
  win.dataset.minimize = rules.minimize;
  win.dataset.maximize = rules.maximize;
  win.dataset.minimized = "false";

  win.innerHTML = `
    <div class="window-header">
      <div class="window-title">${appTitle}</div>
      <div class="window-controls">
        <button class="win-btn" data-action="minimize">▁</button>
        <button class="win-btn" data-action="maximize">▢</button>
        <button class="win-btn" data-action="close">✕</button>
      </div>
    </div>
    <div class="window-body">
      <div class="loading">Loading...</div>
    </div>
  `;

  windowContainer.appendChild(win);
  instances.push(win);

  const instanceId = crypto.randomUUID();
  win.dataset.instanceId = instanceId;
  
  // Store session state for restoration
  if (sessionState) {
    win._pendingSessionState = sessionState;
  }

  // bring to front
  win.addEventListener("mousedown", () => {
    win.style.zIndex = ++zIndexCounter;
  });

  // ==============================
  // LOAD APP CONTENT (WEB vs NATIVE)
  // ==============================

  if (rules.backend !== "native") {

    // 🔒 WEB APP LOADER
    fetch(`${appPath}/index.html`)
      .then((r) => r.text())
      .then((html) => {
        const body = win.querySelector(".window-body");
        
        // Add unique class to scope CSS
        const scopeClass = `app-${appKey}-${instanceId}`;
        body.classList.add(scopeClass);
        
        body.innerHTML = html;
        
        // Load CSS and JS files
        if (!loadedModules[appPath]) {
          return fetch(`/api/apps/${encodeURIComponent(folderName)}/files`)
            .then(r => r.json())
            .then(files => {
              // Load CSS files scoped to this window
              const cssPromises = files.css.map(cssFile => {
                return fetch(`${appPath}/${cssFile}`)
                  .then(r => r.text())
                  .then(css => {
                    // Scope CSS to this specific window instance
                    const scopedCSS = css.replace(/(^|\})\s*([^{]+)\{/g, (match, p1, selector) => {
                      // Don't scope @rules, keyframes, etc
                      if (selector.trim().startsWith('@')) return match;
                      // Scope all other selectors
                      const scoped = selector.split(',').map(s => `.${scopeClass} ${s.trim()}`).join(', ');
                      return `${p1}${scoped}{`;
                    });
                    
                    // Inject scoped CSS into a style tag
                    const style = document.createElement('style');
                    style.setAttribute('data-app', appKey);
                    style.setAttribute('data-instance', instanceId);
                    style.textContent = scopedCSS;
                    body.appendChild(style);
                  });
              });
              
              // Load JS modules
              const jsPromises = files.js.map(file => import(`${appPath}/${file}`));
              
              return Promise.all([...cssPromises, ...jsPromises])
                .then(results => {
                  // Filter out CSS promises (undefined) and keep only JS modules
                  return results.filter(r => r !== undefined);
                });
            })
            .then(modules => {
              loadedModules[appPath] = modules;
              
              // Initialize any module - check ALL exports for init functions
              modules.forEach(module => {
                // 1. Check if init is directly exported as a function
                if (module.init && typeof module.init === 'function') {
                  module.init(body);
                }
                
                // 2. Check if default export has init
                if (module.default && typeof module.default === 'object' && module.default.init && typeof module.default.init === 'function') {
                  module.default.init(body);
                } else if (module.default && typeof module.default === 'function') {
                  // 3. If default export IS a function, call it with body
                  module.default(body);
                }
                
                // 4. Check ALL named exports for objects with init methods
                Object.keys(module).forEach(key => {
                  if (key !== 'default' && key !== 'init' && typeof module[key] === 'object' && module[key] && module[key].init && typeof module[key].init === 'function') {
                    module[key].init(body);
                  }
                });
                
                // Store init context for this instance
                if (!win._moduleInstances) win._moduleInstances = [];
                win._moduleInstances.push(module);
              });
              
              // Setup session state wrapper for this window
              if (rules.sessionState) {
                setupSessionState(win, body);
                
                // Restore session state AFTER app is fully initialized
                if (win._pendingSessionState) {
                  setTimeout(() => {
                    if (win._restoreAppSessionState) {
                      win._restoreAppSessionState(win._pendingSessionState);
                      delete win._pendingSessionState;
                    }
                  }, 300);
                }
              }
            })
            .catch(err => console.error('Failed to load app files:', err));
        } else {
          // Modules already loaded, just initialize for this instance
          const modules = loadedModules[appPath];
          
          // Re-inject CSS for this instance
          fetch(`/api/apps/${encodeURIComponent(folderName)}/files`)
            .then(r => r.json())
            .then(files => {
              files.css.forEach(cssFile => {
                fetch(`${appPath}/${cssFile}`)
                  .then(r => r.text())
                  .then(css => {
                    const scopedCSS = css.replace(/(^|\})\s*([^{]+)\{/g, (match, p1, selector) => {
                      if (selector.trim().startsWith('@')) return match;
                      const scoped = selector.split(',').map(s => `.${scopeClass} ${s.trim()}`).join(', ');
                      return `${p1}${scoped}{`;
                    });
                    
                    const style = document.createElement('style');
                    style.setAttribute('data-app', appKey);
                    style.setAttribute('data-instance', instanceId);
                    style.textContent = scopedCSS;
                    body.appendChild(style);
                  });
              });
            });
          
          // Initialize modules for this instance - check ALL exports for init functions
          modules.forEach(module => {
            // 1. Check if init is directly exported as a function
            if (module.init && typeof module.init === 'function') {
              module.init(body);
            }
            
            // 2. Check if default export has init
            if (module.default && typeof module.default === 'object' && module.default.init && typeof module.default.init === 'function') {
              module.default.init(body);
            } else if (module.default && typeof module.default === 'function') {
              // 3. If default export IS a function, call it with body
              module.default(body);
            }
            
            // 4. Check ALL named exports for objects with init methods
            Object.keys(module).forEach(key => {
              if (key !== 'default' && key !== 'init' && typeof module[key] === 'object' && module[key] && module[key].init && typeof module[key].init === 'function') {
                module[key].init(body);
              }
            });
          });
          
          if (!win._moduleInstances) win._moduleInstances = [];
          win._moduleInstances.push(...modules);
          
          // Setup session state wrapper for this window
          if (rules.sessionState) {
            setupSessionState(win, body);
            
            // Restore session state AFTER app is fully initialized
            if (win._pendingSessionState) {
              setTimeout(() => {
                if (win._restoreAppSessionState) {
                  win._restoreAppSessionState(win._pendingSessionState);
                  delete win._pendingSessionState;
                }
              }, 300);
            }
          }
        }
      })
      .catch(() => {
        win.querySelector(".window-body").innerHTML =
          `<div class="aero-card"><p>Failed to load app.</p></div>`;
      });

  } else {

    // 🧠 NATIVE / STREAMED APP
    attachNativeApp(win, rules);

  }


  // window controls
  win.querySelector("[data-action='close']").addEventListener("click", () => {
    closeWindow(win);
    saveDesktopState();
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
  }

  makeDraggable(win);

  // For non-stacking apps, create individual taskbar icon
  if (!rules.stack) {
    const icon = document.createElement("button");
    icon.className = "task-icon runtime-task-icon";
    icon.dataset.runtime = "true";

    const iconSrc = rules.icon || `/apps/${appKey}/icon.png`;

    icon.innerHTML = `
      <img src="${iconSrc}" alt="${appKey}" class="app-icon"
          style="width: 100%; height: 100%; object-fit: contain;"
          onload="validateIconSize(this)">
      <button class="task-close-btn">✕</button>
    `;

    // Click icon → focus window
    icon.addEventListener("click", () => {
      focusWindow(win);
    });

    // Click close → close THIS window + remove THIS icon
    icon.querySelector(".task-close-btn").addEventListener("click", (e) => {
      e.stopPropagation();
      closeWindow(win);
      saveDesktopState();
    });

    taskbarIcons.appendChild(icon);

    // 🔑 critical: bind icon to this window
    win.taskbarIcon = icon;
  }

  // Get launcher button for stacking apps
  const launcher = document.querySelector(`[data-app="${appKey}"]`);
  if (launcher && rules.stack) {
    if (!launcher.querySelector(".taskbar-indicator")) {
      const bar = document.createElement("div");
      bar.className = "taskbar-indicator";
      launcher.appendChild(bar);
    }
  }

  updateTaskbarIndicator(appKey);
  
  // Save state after opening a window (unless restoring)
  if (!isRestoringState) {
    saveDesktopState();
  }
}

function focusWindow(win) {
  win.dataset.minimized = "false";
  win.style.display = "block";
  win.style.zIndex = ++zIndexCounter;
  // If it was temp unminimized, reset the styles
  if (win.isTempUnminimized) {
    win.style.opacity = "";
    win.style.pointerEvents = "";
    win.style.border = "";
    win.style.boxShadow = "";
    delete win.isTempUnminimized;
  }
}

function closeWindow(win) {
  const appKey = win.dataset.appKey;
  const instanceId = win.dataset.instanceId;
  
  // Clean up instance-specific styles
  document.querySelectorAll(`style[data-instance="${instanceId}"]`).forEach(style => {
    style.remove();
  });
  
  appInstances[appKey] = appInstances[appKey].filter((w) => w !== win);
  if (win.taskbarIcon) {
    win.taskbarIcon.remove();
  }
  win.remove();
  updateTaskbarIndicator(appKey);
  
  // Save state after closing a window (unless restoring)
  if (!isRestoringState) {
    saveDesktopState();
  }
  
  const appPath = win.dataset.app;
  if (loadedModules[appPath]) {
    delete loadedModules[appPath];
  }
  const rules = appRules[win.dataset.appKey];
  if (rules?.backend === "native") {
    socket.emit("native:kill", {
      instanceId: win.dataset.instanceId
    });
  }
}

function minimizeWindow(win) {
  // capture preview before hiding
  html2canvas(win, { backgroundColor: null }).then(canvas => {
    win.storedPreview = canvas.toDataURL("image/png");
  });
  win.dataset.minimized = "true";
  win.minimizedAt = Date.now(); // track minimization time
  win.style.display = "none";
  updateTaskbarIndicator(win.dataset.appKey);
  
  // Save state after minimizing
  if (!isRestoringState) {
    saveDesktopState();
  }
}

function updateTaskbarIndicator(appKey) {
  const rules = appRules[appKey] || {};
  const launcher = document.querySelector(`[data-app="${appKey}"]`);

  const instances = appInstances[appKey] || [];
  const show = instances.length > 0;

  if (launcher && rules.stack) {
    const bar = launcher.querySelector(".taskbar-indicator");
    if (bar) bar.style.display = show ? "block" : "none";
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

  let imgSrc;
  if (win.dataset.minimized === "true" && win.storedPreview) {
    imgSrc = win.storedPreview;
  } else if (win.style.display === "none" && win.storedPreview) {
    // If window is hidden but not minimized, use stored preview
    imgSrc = win.storedPreview;
  } else {
    const canvas = await html2canvas(win, { backgroundColor: null });
    imgSrc = canvas.toDataURL("image/png");
    win.storedPreview = imgSrc; // store for future use
  }

  const img = document.createElement("img");
  img.src = imgSrc;
  img.className = "stack-preview-img";
  inner.appendChild(img);

  preview.appendChild(inner);
  return preview;
}

// Phantom window functions (temporarily unminimize)
function showTempUnminimized(win) {
  if (win.dataset.minimized !== "true") return; // don't show if already unminimized
  hideAllTempUnminimized(); // ensure only one at a time
  win.style.display = "block";
  win.style.opacity = "0.8";
  win.style.pointerEvents = "none";
  win.style.zIndex = "9999";
  win.style.border = "2px solid #0078d4";
  win.style.boxShadow = "0 0 20px rgba(0,120,212,0.5)";
  win.isTempUnminimized = true;
}

function hideTempUnminimized(win) {
  if (win.isTempUnminimized) {
    win.style.display = "none";
    win.style.opacity = "";
    win.style.pointerEvents = "";
    win.style.zIndex = "";
    win.style.border = "";
    win.style.boxShadow = "";
    delete win.isTempUnminimized;
  }
}

function hideAllTempUnminimized() {
  document.querySelectorAll('.window').forEach(win => {
    if (win.isTempUnminimized) {
      hideTempUnminimized(win);
    }
  });
}

async function openStackMenu(app, icon) {
  // remove any other app's stack menu
  document.querySelectorAll(".stack-menu").forEach(m => m.remove());
  hideAllTempUnminimized(); // hide any temp unminimized

  const instances = appInstances[app] || [];
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
        <span class="stack-title">${app.toUpperCase()} (${i + 1})</span>
        <button class="stack-close">✕</button>
      </div>
    `;

    const closeBtn = item.querySelector(".stack-close");
    const preview = await createLivePreview(win);

    item.appendChild(preview);

    item.addEventListener("click", () => {
      focusWindow(win);
      menu.remove();
      hideAllTempUnminimized();
    });

    closeBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      closeWindow(win);
      menu.remove();
      hideAllTempUnminimized();
    });

    // Add temp unminimize hover
    item.addEventListener("mouseenter", () => {
      if (item.hoverTimeout) clearTimeout(item.hoverTimeout);
      item.hoverTimeout = setTimeout(() => showTempUnminimized(win), 500);
    });

    item.addEventListener("mouseleave", () => {
      if (item.hoverTimeout) clearTimeout(item.hoverTimeout);
      hideTempUnminimized(win);
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
    menu.style.zIndex = "10000"; // ensure menu is above temp unminimized windows
  });

  menu.addEventListener("mouseenter", () => {
    clearTimeout(menuTimers[app]);
  });

  menu.addEventListener("mouseleave", () => {
    menuTimers[app] = setTimeout(() => {
      menu.remove();
      hideAllTempUnminimized();
    }, 200);
  });
}


function maximizeWindow(win) {
  if (win.classList.contains("maximized")) {
    win.classList.remove("maximized");
    win.style.width = "";
    win.style.height = "";
    win.style.top = "70px";
    win.style.left = "70px";
    if (!isRestoringState) {
      saveDesktopState();
    }
  } else {
    win.classList.add("maximized");
    win.style.top = "0";
    win.style.left = "0";
    win.style.width = "100%";
    win.style.height = "calc(100% - 54px)";
    if (!isRestoringState) {
      saveDesktopState();
    }
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
    if (dragging) {
      dragging = false;
      header.style.cursor = "grab";
      // Save state after moving window
      if (!isRestoringState) {
        saveDesktopState();
      }
    }
  });
}

function makeResizable(win) {
  let resizing = false;
  let resizeMode = '';
  let startX, startY, startWidth, startHeight, startLeft, startTop;

  const threshold = 10; // pixels from edge to trigger resize

  function getResizeMode(e) {
    const rect = win.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const w = rect.width;
    const h = rect.height;

    let mode = '';

    if (y < threshold) mode += 'n';
    else if (y > h - threshold) mode += 's';

    if (x < threshold) mode += 'w';
    else if (x > w - threshold) mode += 'e';

    return mode;
  }

  win.addEventListener("mousemove", (e) => {
    if (resizing) return;
    const mode = getResizeMode(e);
    if (mode) {
      const cursors = {
        'n': 'n-resize',
        's': 's-resize',
        'e': 'e-resize',
        'w': 'w-resize',
        'ne': 'ne-resize',
        'nw': 'nw-resize',
        'se': 'se-resize',
        'sw': 'sw-resize'
      };
      win.style.cursor = cursors[mode] || 'default';
    } else {
      win.style.cursor = 'default';
    }
  });

  win.addEventListener("mousedown", (e) => {
    const mode = getResizeMode(e);
    if (mode) {
      resizing = true;
      resizeMode = mode;
      startX = e.clientX;
      startY = e.clientY;
      startWidth = win.offsetWidth;
      startHeight = win.offsetHeight;
      startLeft = win.offsetLeft;
      startTop = win.offsetTop;
      e.preventDefault();
    }
  });

  document.addEventListener("mousemove", (e) => {
    if (!resizing) return;
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;

    if (resizeMode.includes('e')) {
      const newWidth = Math.max(200, startWidth + dx);
      win.style.width = `${newWidth}px`;
    }
    if (resizeMode.includes('s')) {
      const newHeight = Math.max(100, startHeight + dy);
      win.style.height = `${newHeight}px`;
    }
    if (resizeMode.includes('w')) {
      const newWidth = Math.max(200, startWidth - dx);
      win.style.width = `${newWidth}px`;
      win.style.left = `${startLeft + dx}px`;
    }
    if (resizeMode.includes('n')) {
      const newHeight = Math.max(100, startHeight - dy);
      win.style.height = `${newHeight}px`;
      win.style.top = `${startTop + dy}px`;
    }
  });

  document.addEventListener("mouseup", () => {
    if (resizing) {
      resizing = false;
      resizeMode = '';
      // Save state after resizing window
      if (!isRestoringState) {
        saveDesktopState();
      }
    }
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

document.addEventListener("click", (e) => {
  if (!e.target || !e.target.closest) return;
  const btn = e.target.closest(".task-icon[data-app], .start-tile[data-app]");
  if (!btn) return;

  // 🛑 block app-content clicks
  if (btn.closest(".window")) return;

  let clickCount = btn._clickCount || 0;
  clearTimeout(btn._clickTimer);

  clickCount++;
  btn._clickCount = clickCount;

  if (clickCount === 1) {
    btn._clickTimer = setTimeout(() => {
      btn._clickCount = 0;

      const appKey = btn.dataset.app;
      const instances = appInstances[appKey] || [];
      const minimized = instances.filter(w => w.dataset.minimized === "true");

      if (minimized.length > 0) {
        minimized.sort((a, b) => b.minimizedAt - a.minimizedAt);
        focusWindow(minimized[0]);
      } else {
        const rules = appRules[appKey] || {};
        if (rules.stack && instances.length > 0) {
          openStackMenu(appKey, btn);
        }
      }
    }, 250);
  }

  if (clickCount === 2) {
    btn._clickCount = 0;
    openApp(btn.dataset.app);
    startMenu.style.display = "none";
  }
});

document.addEventListener("mouseenter", (e) => {
  if (!e.target || !e.target.closest) return;
  const btn = e.target.closest("[data-app]");
  if (!btn) return;

  const appKey = btn.dataset.app;
  const rules = appRules[appKey] || {};

  if (!rules.stack) return;

  clearTimeout(menuTimers[appKey]);

  menuTimers[appKey] = setTimeout(() => {
    openStackMenu(appKey, btn);
  }, 300);
}, true); // <-- CAPTURE PHASE (important)

document.addEventListener("mouseleave", (e) => {
  if (!e.target || !e.target.closest) return;
  const btn = e.target.closest("[data-app]");
  if (!btn) return;

  const appKey = btn.dataset.app;

  menuTimers[appKey] = setTimeout(() => {
    const menu = document.querySelector(".stack-menu");
    if (menu && !menu.matches(":hover")) {
      menu.remove();
      hideAllTempUnminimized();
    }
  }, 200);
}, true); // <-- CAPTURE PHASE


// COM communication
function showUAC(risks) {
  const overlay = document.getElementById("uacOverlay");
  const pages = document.getElementById("uacPages");

  pages.innerHTML = "";

  risks.forEach(risk => {
    const page = document.createElement("div");
    page.className = "uac-page";
    page.innerHTML = `
      <p><strong>Warning:</strong> This command uses <code>${risk}</code></p>
      <p>This may modify system files or permissions.</p>
    `;
    pages.appendChild(page);
  });

  overlay.classList.remove("hidden");
}

function approveUAC() {
  socket.emit("uac:approve");
  closeUAC();
}

function denyUAC() {
  socket.emit("uac:deny");
  closeUAC();
}

function closeUAC() {
  document.getElementById("uacOverlay").classList.add("hidden");
}
// ==============================


// EXECUTE COMMAND VIA API
async function execCommand(command) {
  const res = await fetch("/api/exec", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-socket-id": socketId
    },
    body: JSON.stringify({ command })
  });

  const data = await res.json();

  if (!res.ok) {
    throw data;
  }

  // If UAC is required, server responds with { pending: true }
  if (data.pending) {
    console.warn("⚠️ UAC approval required");
    return data;
  }

  return data;
}

function attachNativeApp(win, rules) {
  const body = win.querySelector(".window-body");

  body.innerHTML = `
    <iframe
      class="native-stream"
      src="/stream/${win.dataset.instanceId}"
      frameborder="0"
      allow="autoplay; fullscreen"
      style="width:100%; height:100%; background:black;">
    </iframe>
  `;

  socket.emit("native:launch", {
    appKey: win.dataset.appKey,
    instanceId: win.dataset.instanceId,
    command: rules.command,
    stream: rules.stream || "xpra"
  });
}


async function run(cmd) {
  const res = await execCommand(cmd);
  console.log(res.stdout || res.stderr);
}
// ==============================