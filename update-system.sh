#!/bin/bash
# FrutigerLinux Auto-Update System
# Checks GitHub for updates and applies them automatically

REPO_URL="https://github.com/BV0073194/FrutigerLinuxWEB-OS"
INSTALL_DIR="/opt/FrutigerLinuxWEB-OS"
LOG_FILE="/var/log/frutiger-update.log"
LOCK_FILE="/var/lock/frutiger-update.lock"

# Ensure only one instance runs at a time
if [ -f "$LOCK_FILE" ]; then
    echo "[$(date)] Update already in progress, exiting" >> "$LOG_FILE"
    exit 0
fi

touch "$LOCK_FILE"
trap "rm -f $LOCK_FILE" EXIT

log_message() {
    echo "[$(date)] $1" >> "$LOG_FILE"
}

log_message "===== Starting update check ====="

# Check if installation directory exists
if [ ! -d "$INSTALL_DIR" ]; then
    log_message "ERROR: Installation directory $INSTALL_DIR does not exist"
    log_message "Cloning repository for the first time..."
    
    mkdir -p /opt
    cd /opt
    if git clone "$REPO_URL" "$INSTALL_DIR"; then
        log_message "Successfully cloned repository"
        cd "$INSTALL_DIR"
        
        # Run setup script on first install
        if [ -f "./setup.sh" ]; then
            log_message "Running setup.sh..."
            bash ./setup.sh >> "$LOG_FILE" 2>&1
            log_message "Setup completed"
        fi
    else
        log_message "ERROR: Failed to clone repository"
        exit 1
    fi
    exit 0
fi

# Navigate to installation directory
cd "$INSTALL_DIR" || {
    log_message "ERROR: Cannot access $INSTALL_DIR"
    exit 1
}

# Fetch latest changes from remote
log_message "Fetching latest changes from GitHub..."
git fetch origin main >> "$LOG_FILE" 2>&1

# Check if there are updates
LOCAL_COMMIT=$(git rev-parse HEAD)
REMOTE_COMMIT=$(git rev-parse origin/main)

if [ "$LOCAL_COMMIT" = "$REMOTE_COMMIT" ]; then
    log_message "Already up to date (commit: ${LOCAL_COMMIT:0:7})"
    exit 0
fi

log_message "Update available: ${LOCAL_COMMIT:0:7} -> ${REMOTE_COMMIT:0:7}"

# Stash any local changes (shouldn't be any in production)
git stash >> "$LOG_FILE" 2>&1

# Pull latest changes
log_message "Pulling updates..."
if git pull origin main >> "$LOG_FILE" 2>&1; then
    log_message "Successfully updated to commit ${REMOTE_COMMIT:0:7}"
    
    # Check if package.json changed (need to reinstall dependencies)
    if git diff --name-only "$LOCAL_COMMIT" "$REMOTE_COMMIT" | grep -q "package.json"; then
        log_message "package.json changed, reinstalling Node.js dependencies..."
        cd "$INSTALL_DIR/server" || exit 1
        npm install >> "$LOG_FILE" 2>&1
        log_message "Dependencies updated"
    fi
    
    # Restart the Node.js service if it's running
    if systemctl --user is-active frutiger-webos.service &>/dev/null; then
        log_message "Restarting frutiger-webos.service..."
        systemctl --user restart frutiger-webos.service
        log_message "Service restarted"
    fi
    
    # Restart Xpra service if configuration changed
    if git diff --name-only "$LOCAL_COMMIT" "$REMOTE_COMMIT" | grep -q "xpra"; then
        if systemctl --user is-active xpra.service &>/dev/null; then
            log_message "Restarting xpra.service..."
            systemctl --user restart xpra.service
            log_message "Xpra service restarted"
        fi
    fi
    
    log_message "Update completed successfully"
else
    log_message "ERROR: Failed to pull updates"
    git stash pop >> "$LOG_FILE" 2>&1
    exit 1
fi

log_message "===== Update check completed ====="
