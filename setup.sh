#!/bin/bash

# ============================================
# FrutigerLinuxWEB-OS Setup Script
# For Debian-based Linux (Headless/GUI)
# ============================================

set -e  # Exit on error

echo "=================================="
echo "FrutigerLinuxWEB-OS Setup Script"
echo "=================================="
echo ""

# Check if running as root
if [ "$EUID" -eq 0 ]; then 
    echo "⚠️  Please do not run as root. Run as normal user with sudo access."
    exit 1
fi

echo "📦 Updating package lists..."
sudo apt update

# ============================================
# 1. INSTALL CURL AND WGET (prerequisites)
# ============================================
echo ""
echo "📦 Installing prerequisites..."
sudo apt install -y curl wget gnupg2 ca-certificates lsb-release apt-transport-https

# ============================================
# 2. INSTALL NODE.JS AND NPM
# ============================================
echo ""
echo "📦 Installing Node.js and npm..."

# Check current Node.js version
NODE_VERSION=""
if command -v node &> /dev/null; then
    NODE_VERSION=$(node --version | cut -d'v' -f2 | cut -d'.' -f1)
fi

# Install or upgrade if needed
if [ -z "$NODE_VERSION" ] || [ "$NODE_VERSION" -lt 20 ]; then
    if [ ! -z "$NODE_VERSION" ]; then
        echo "⚠️  Node.js $NODE_VERSION detected. Upgrading to Node.js 20.x..."
        # Remove old Node.js first
        sudo apt remove -y nodejs npm
        sudo apt autoremove -y
    fi
    
    echo "📥 Installing Node.js 20.x from NodeSource..."
    
    # Clean up any old NodeSource lists
    sudo rm -f /etc/apt/sources.list.d/nodesource.list
    
    # Download and run NodeSource setup
    curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
    
    # Install Node.js (includes npm)
    sudo apt install -y nodejs
    
    # Verify installation
    if ! command -v node &> /dev/null; then
        echo "❌ ERROR: Node.js installation failed!"
        echo "Please install Node.js 20.x manually:"
        echo "  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -"
        echo "  sudo apt install -y nodejs"
        exit 1
    fi
    
    # Check version
    NODE_VERSION=$(node --version | cut -d'v' -f2 | cut -d'.' -f1)
    if [ "$NODE_VERSION" -lt 20 ]; then
        echo "❌ ERROR: Node.js $NODE_VERSION installed, but version 20+ is required!"
        echo "Please install Node.js 20.x manually from https://nodejs.org/"
        exit 1
    fi
    
    echo "✅ Node.js installed: $(node --version)"
    echo "✅ npm installed: $(npm --version)"
else
    echo "✅ Node.js $(node --version) is already installed (version 20+)"
    echo "✅ npm version: $(npm --version)"
fi

# Final verification
if ! command -v npm &> /dev/null; then
    echo "❌ ERROR: npm not found. Installing npm..."
    sudo apt install -y npm
fi

# ============================================
# 3. INSTALL PROJECT DEPENDENCIES
# ============================================
echo ""
echo "📦 Installing project dependencies..."
cd "$(dirname "$0")"

# Verify npm is available before proceeding
if ! command -v npm &> /dev/null; then
    echo "❌ ERROR: npm is still not available. Please install Node.js manually."
    echo "Try: sudo apt install nodejs npm"
    exit 1
fi

# Check if package.json exists
if [ ! -f "package.json" ]; then
    echo "❌ ERROR: package.json not found in current directory."
    echo "Make sure you're running this script from the project root."
    exit 1
fi

npm install
echo "✅ npm packages installed"

# ============================================
# 4. INSTALL XPRA (for GUI app streaming)
# ============================================
echo ""
echo "📦 Installing Xpra for app streaming..."
if ! command -v xpra &> /dev/null; then
    sudo apt install -y xpra xpra-html5
    echo "✅ Xpra installed"
else
    echo "✅ Xpra already installed"
fi

# ============================================
# 5. INSTALL CHROMIUM FOR KIOSK MODE
# ============================================
echo ""
echo "📦 Installing Chromium browser for kiosk mode..."
if ! command -v chromium &> /dev/null && ! command -v chromium-browser &> /dev/null; then
    sudo apt install -y chromium chromium-browser
    echo "✅ Chromium installed"
else
    echo "✅ Chromium already installed"
fi

# Determine chromium command
if command -v chromium &> /dev/null; then
    CHROMIUM_CMD="chromium"
elif command -v chromium-browser &> /dev/null; then
    CHROMIUM_CMD="chromium-browser"
else
    CHROMIUM_CMD="chromium"
fi

# ============================================
# 6. INSTALL X SERVER (if not present)
# ============================================
echo ""
echo "📦 Checking for X server..."
if ! dpkg -l | grep -q xserver-xorg; then
    echo "Installing minimal X server..."
    sudo apt install -y xserver-xorg xinit x11-xserver-utils
    echo "✅ X server installed"
else
    echo "✅ X server already installed"
fi

# ============================================
# 7. INSTALL OPENBOX (minimal window manager)
# ============================================
echo ""
echo "📦 Installing Openbox window manager..."
if ! command -v openbox &> /dev/null; then
    sudo apt install -y openbox
    echo "✅ Openbox installed"
else
    echo "✅ Openbox already installed"
fi

# ============================================
# 8. OPTIONAL: INSTALL SUNSHINE (for game streaming)
# ============================================
echo ""
read -p "📦 Install Sunshine for game streaming? (y/N): " install_sunshine
if [[ $install_sunshine =~ ^[Yy]$ ]]; then
    echo "Installing Sunshine..."
    if ! command -v sunshine &> /dev/null; then
        # Add Sunshine repository
        wget -qO - https://apt.lizardbyte.dev/lizardbyte.gpg | sudo apt-key add -
        echo "deb https://apt.lizardbyte.dev/ $(lsb_release -cs) main" | sudo tee /etc/apt/sources.list.d/lizardbyte.list
        sudo apt update
        sudo apt install -y sunshine
        echo "✅ Sunshine installed"
    else
        echo "✅ Sunshine already installed"
    fi
else
    echo "⏭️  Skipping Sunshine installation"
fi

# ============================================
# 9. CREATE KIOSK STARTUP SCRIPT
# ============================================
echo ""
echo "📝 Creating kiosk startup script..."

cat > ~/start-kiosk.sh << 'KIOSK_SCRIPT'
#!/bin/bash

# Start the Node.js server in background
cd "$(dirname "$0")"
node server/server.js &
SERVER_PID=$!

# Wait for server to start
echo "Waiting for server to start..."
sleep 5

# Start Chromium in kiosk mode
$CHROMIUM_CMD \
    --kiosk \
    --noerrdialogs \
    --disable-infobars \
    --no-first-run \
    --check-for-update-interval=31536000 \
    --disable-session-crashed-bubble \
    --disable-features=TranslateUI \
    --start-fullscreen \
    http://localhost:3000

# Cleanup when browser closes
kill $SERVER_PID 2>/dev/null
KIOSK_SCRIPT

# Replace placeholder with actual chromium command
sed -i "s/\$CHROMIUM_CMD/$CHROMIUM_CMD/g" ~/start-kiosk.sh
chmod +x ~/start-kiosk.sh

echo "✅ Kiosk script created at ~/start-kiosk.sh"

# ============================================
# 10. CREATE SYSTEMD SERVICE (optional)
# ============================================
echo ""
read -p "📦 Create systemd service for auto-start? (y/N): " create_service
if [[ $create_service =~ ^[Yy]$ ]]; then
    PROJECT_DIR="$(pwd)"
    USER_NAME="$(whoami)"
    
    sudo tee /etc/systemd/system/frutiger-webos.service > /dev/null << EOF
[Unit]
Description=FrutigerLinuxWEB-OS Server
After=network.target

[Service]
Type=simple
User=$USER_NAME
WorkingDirectory=$PROJECT_DIR
ExecStart=/usr/bin/node $PROJECT_DIR/server/server.js
Restart=on-failure
RestartSec=10
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
EOF

    sudo systemctl daemon-reload
    sudo systemctl enable frutiger-webos.service
    
    echo "✅ Systemd service created and enabled"
    echo "   Start with: sudo systemctl start frutiger-webos"
    echo "   Check status: sudo systemctl status frutiger-webos"
else
    echo "⏭️  Skipping systemd service creation"
fi

# ============================================
# 11. CREATE AUTOSTART FOR KIOSK (GUI)
# ============================================
echo ""
read -p "📦 Setup automatic kiosk mode on boot? (y/N): " setup_autostart
if [[ $setup_autostart =~ ^[Yy]$ ]]; then
    mkdir -p ~/.config/openbox
    
    cat > ~/.config/openbox/autostart << EOF
# Start the kiosk
bash ~/start-kiosk.sh &
EOF

    # Create .xinitrc for startx
    cat > ~/.xinitrc << EOF
#!/bin/bash
exec openbox-session
EOF
    
    chmod +x ~/.xinitrc
    
    # Setup auto-login (optional)
    read -p "📦 Setup auto-login for $(whoami)? (y/N): " setup_autologin
    if [[ $setup_autologin =~ ^[Yy]$ ]]; then
        sudo mkdir -p /etc/systemd/system/getty@tty1.service.d
        sudo tee /etc/systemd/system/getty@tty1.service.d/override.conf > /dev/null << AUTOLOGIN
[Service]
ExecStart=
ExecStart=-/sbin/agetty --autologin $(whoami) --noclear %I \$TERM
AUTOLOGIN
        
        # Add startx to .bash_profile
        if ! grep -q "startx" ~/.bash_profile 2>/dev/null; then
            cat >> ~/.bash_profile << XSTART

# Start X on login
if [ -z "\$DISPLAY" ] && [ "\$(tty)" = "/dev/tty1" ]; then
    startx
fi
XSTART
        fi
        
        echo "✅ Auto-login configured for $(whoami)"
    fi
    
    echo "✅ Kiosk autostart configured"
else
    echo "⏭️  Skipping autostart configuration"
fi

# ============================================
# 12. CREATE EXAMPLE APP DIRECTORIES
# ============================================
echo ""
echo "📁 Ensuring app directories exist..."
mkdir -p public/apps/os
mkdir -p public/apps/notepad
mkdir -p public/apps/software
mkdir -p "public/apps/firefox xpra"
mkdir -p "public/apps/steam sunshine"
mkdir -p server/uploads
mkdir -p server/os

# ============================================
# 13. FINAL INSTRUCTIONS
# ============================================
echo ""
echo "=========================================="
echo "✅ Setup Complete!"
echo "=========================================="
echo ""
echo "📝 Quick Start:"
echo "   1. Manual start: npm start"
echo "   2. Kiosk mode:   bash ~/start-kiosk.sh"
echo "   3. Service:      sudo systemctl start frutiger-webos"
echo ""
echo "🌐 Access the OS at: http://localhost:3000"
echo ""
echo "📋 Testing Xpra apps:"
echo "   - Install an app: sudo apt install firefox-esr"
echo "   - Configure in app.properties.json"
echo "   - Xpra will stream GUI to browser"
echo ""
echo "📋 Next Steps:"
echo "   1. Place FrutigerAeroOS.exe in server/os/"
echo "   2. Add software files to server/uploads/"
echo "   3. Customize app properties in public/apps/"
echo ""
echo "🔄 Reboot to test auto-start: sudo reboot"
echo ""
