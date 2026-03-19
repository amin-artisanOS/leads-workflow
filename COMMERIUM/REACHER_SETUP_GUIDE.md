# 🔒 Self-Hosted Email Verification System
## Using Reacher + HostGram VPS

---

## 📋 STEP 1: Get a VPS from HostGram

1. Go to [hostgram.pl](https://hostgram.pl) or [hostgram.com](https://hostgram.com)
2. Products → Cloud VPS
3. Choose **Middleweight** ($20/month) or **Lightweight** ($10/month)
4. Complete signup

---

## 📋 STEP 2: Request Port 25 Unblock

**IMPORTANT**: Before installing anything, contact HostGram support and request port 25 unblock.

Copy this template and send to their support:

```
Subject: Request to Unblock Port 25

Hi HostGram Support,

I recently purchased a VPS and would like to request that you unblock port 25 
on my server. I am building a light email verification tool as part of my 
application and need SMTP access for verification purposes.

My VPS IP: [YOUR_VPS_IP]
Account Email: [YOUR_EMAIL]

Thank you for your help.
```

Wait for confirmation (usually within 12-24 hours).

---

## 📋 STEP 3: Connect to Your VPS

Option A: Use HostGram Console
- Go to Services → Control Panel → Your VPS → Manage → Console

Option B: SSH from your terminal
```bash
ssh root@YOUR_VPS_IP
```

---

## 📋 STEP 4: Install Docker

Run these commands ONE BY ONE:

```bash
# Update system
sudo apt update && sudo apt upgrade -y

# Install dependencies
sudo apt install -y apt-transport-https ca-certificates curl software-properties-common

# Add Docker GPG key
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /usr/share/keyrings/docker-archive-keyring.gpg

# Add Docker repository
echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/docker-archive-keyring.gpg] https://download.docker.com/linux/ubuntu $(lsb_release -cs) stable" | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null

# Install Docker
sudo apt update
sudo apt install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin

# Start Docker
sudo systemctl start docker
sudo systemctl enable docker

# Verify installation
docker --version
```

---

## 📋 STEP 5: Create Reacher Directory

```bash
mkdir -p ~/reacher
cd ~/reacher
```

---

## 📋 STEP 6: Create Docker Compose File

Create the file:
```bash
nano docker-compose.yml
```

Paste this content (replace YOUR_API_KEY with a random string):
```yaml
version: '3.8'

services:
  reacher:
    image: reacherhq/backend:latest
    container_name: reacher
    ports:
      - "8080:8080"
    environment:
      - RCH__BACKEND__HOST=0.0.0.0
      - RCH__BACKEND__PORT=8080
      - RCH__HEADER_SECRET=YOUR_API_KEY_HERE
    restart: unless-stopped
```

Save: `Ctrl+X`, then `Y`, then `Enter`

---

## 📋 STEP 7: Start Reacher

```bash
docker compose up -d
```

Check if it's running:
```bash
docker ps
```

You should see the `reacher` container running.

---

## 📋 STEP 8: Test Your Installation

From your local machine, test the API:

```bash
curl -X POST http://YOUR_VPS_IP:8080/v0/check_email \
  -H "Content-Type: application/json" \
  -H "Authorization: YOUR_API_KEY_HERE" \
  -d '{"to_email": "test@gmail.com"}'
```

If you get a JSON response with email verification data, it's working!

---

## 📋 STEP 9: (Optional) Set Up Domain + SSL

If you want a nice domain like `verify.yourdomain.com`:

1. Add A Record in your DNS:
   - Type: A
   - Name: verify
   - Value: YOUR_VPS_IP

2. Install Nginx + Certbot:
```bash
sudo apt install -y nginx certbot python3-certbot-nginx
```

3. Create Nginx config:
```bash
sudo nano /etc/nginx/sites-available/reacher
```

Paste:
```nginx
server {
    listen 80;
    server_name verify.yourdomain.com;

    location / {
        proxy_pass http://localhost:8080;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

4. Enable and get SSL:
```bash
sudo ln -s /etc/nginx/sites-available/reacher /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl restart nginx
sudo certbot --nginx -d verify.yourdomain.com
```

---

## 🚀 USAGE

Your Reacher API endpoint:
- Direct: `http://YOUR_VPS_IP:8080/v0/check_email`
- With domain: `https://verify.yourdomain.com/v0/check_email`

API Request:
```json
POST /v0/check_email
Headers:
  - Content-Type: application/json
  - Authorization: YOUR_API_KEY

Body:
{
  "to_email": "test@example.com"
}
```

---

## 💰 COST BREAKDOWN

| Item | Cost |
|------|------|
| HostGram VPS | $10-20/month |
| Reacher | FREE (self-hosted) |
| Domain (optional) | ~$10/year |
| **TOTAL** | ~$10-20/month |

Compare to:
- MillionVerifier: $37/month for 10k
- ZeroBounce: $15 for 2,000
- NeverBounce: $8 for 1,000

**You get**: 10,000+ verifications/day for $10-20/month flat!

---

## ⚠️ LIMITS

- Free self-hosted: ~10,000 verifications/day (proxy limit)
- To scale higher: Need Reacher commercial license ($750/month) + Proxy25

For most use cases, 10k/day = 300k/month is MORE than enough!
