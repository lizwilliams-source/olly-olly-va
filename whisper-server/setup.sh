#!/bin/bash
set -e

echo ""
echo "======================================"
echo "  Olly Olly Whisper Server Setup"
echo "======================================"
echo ""

# ── System packages ──────────────────────────────────────────────────────────
apt-get update -q
apt-get install -y python3 python3-pip python3-venv ffmpeg curl ufw

# ── Firewall ─────────────────────────────────────────────────────────────────
ufw allow 22/tcp
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable

# ── Install Caddy (automatic HTTPS) ──────────────────────────────────────────
apt-get install -y debian-keyring debian-archive-keyring apt-transport-https
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' > /etc/apt/sources.list.d/caddy-stable.list
apt-get update -q
apt-get install -y caddy

# ── App directory ─────────────────────────────────────────────────────────────
mkdir -p /opt/whisper
cp "$(dirname "$0")/app.py" /opt/whisper/app.py
cp "$(dirname "$0")/requirements.txt" /opt/whisper/requirements.txt

# ── Python environment ────────────────────────────────────────────────────────
python3 -m venv /opt/whisper/venv
/opt/whisper/venv/bin/pip install --upgrade pip -q
/opt/whisper/venv/bin/pip install -r /opt/whisper/requirements.txt -q

# ── Pre-download model ────────────────────────────────────────────────────────
echo ""
echo "Downloading Whisper model (~1.5GB, this takes a few minutes)..."
WHISPER_SECRET_KEY=setup /opt/whisper/venv/bin/python3 -c \
  "import faster_whisper; faster_whisper.WhisperModel('large-v3-turbo', device='cpu', compute_type='int8'); print('Model downloaded.')"

# ── Generate secret key ───────────────────────────────────────────────────────
SECRET=$(openssl rand -hex 32)

# ── Whisper systemd service ───────────────────────────────────────────────────
cat > /etc/systemd/system/whisper.service << EOF
[Unit]
Description=Olly Olly Whisper Server
After=network.target

[Service]
WorkingDirectory=/opt/whisper
Environment="WHISPER_SECRET_KEY=${SECRET}"
Environment="WHISPER_MODEL=large-v3-turbo"
ExecStart=/opt/whisper/venv/bin/uvicorn app:app --host 127.0.0.1 --port 8000 --timeout-keep-alive 1800
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable whisper
systemctl start whisper

# ── HTTPS via Caddy + sslip.io ────────────────────────────────────────────────
IP=$(curl -s https://api.ipify.org)
DOMAIN="${IP//./-}.sslip.io"

cat > /etc/caddy/Caddyfile << EOF
${DOMAIN} {
    reverse_proxy 127.0.0.1:8000
}
EOF

systemctl restart caddy

# ── Done ──────────────────────────────────────────────────────────────────────
echo ""
echo "======================================"
echo "  Setup complete!"
echo "======================================"
echo ""
echo "Add these two variables to Vercel:"
echo ""
echo "  WHISPER_SERVER_URL = https://${DOMAIN}"
echo "  WHISPER_SERVER_KEY = ${SECRET}"
echo ""
echo "Test it's working:"
echo "  curl https://${DOMAIN}/health"
echo ""
