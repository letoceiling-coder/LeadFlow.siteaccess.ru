#!/bin/sh
set -eu
install -d -m 755 /var/www/letsencrypt
cat > /etc/nginx/sites-available/leadflow.siteaccess.ru << 'EOF'
server {
    listen 80;
    listen [::]:80;
    server_name leadflow.siteaccess.ru;
    include snippets/hostcare-verify.conf;
    location ^~ /.well-known/acme-challenge/ { root /var/www/letsencrypt; }
    location / { return 301 https://$host$request_uri; }
}
EOF
ln -sfn /etc/nginx/sites-available/leadflow.siteaccess.ru /etc/nginx/sites-enabled/leadflow.siteaccess.ru
nginx -t
systemctl reload nginx
certbot certonly --webroot -w /var/www/letsencrypt -d leadflow.siteaccess.ru --non-interactive --keep-until-expiring
cat > /etc/nginx/sites-available/leadflow.siteaccess.ru << 'EOF'
server {
    listen 80;
    listen [::]:80;
    server_name leadflow.siteaccess.ru;
    include snippets/hostcare-verify.conf;
    location ^~ /.well-known/acme-challenge/ { root /var/www/letsencrypt; }
    location / { return 301 https://$host$request_uri; }
}

server {
    listen 443 ssl http2;
    listen [::]:443 ssl http2;
    server_name leadflow.siteaccess.ru;
    include snippets/hostcare-verify.conf;
    ssl_certificate /etc/letsencrypt/live/leadflow.siteaccess.ru/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/leadflow.siteaccess.ru/privkey.pem;
    include /etc/letsencrypt/options-ssl-nginx.conf;
    ssl_dhparam /etc/letsencrypt/ssl-dhparams.pem;
    client_max_body_size 20m;

    location ^~ /.well-known/acme-challenge/ { root /var/www/letsencrypt; }

    location / {
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Connection "";
        proxy_buffering off;
        proxy_read_timeout 300s;
        proxy_pass http://127.0.0.1:3100;
    }
}
EOF
nginx -t
systemctl reload nginx
echo '---LEADFLOW---'
curl -sS -m 20 -o /dev/null -w 'leadflow %{http_code}\n' https://leadflow.siteaccess.ru/login
echo '---NEIGHBOR---'
curl -sS -m 20 -o /dev/null -w 'lovable %{http_code}\n' https://lovable.siteaccess.ru/ || true
curl -sS -m 20 -o /dev/null -w 'harness %{http_code}\n' https://harness.siteaccess.ru/ || true
