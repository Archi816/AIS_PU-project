# Static LEMS web UI served by nginx. /api/* is proxied to the backend container (see nginx.conf.template).
FROM nginxinc/nginx-unprivileged:1.27-alpine
# BACKEND_URL is substituted into the template at container start (official nginx image feature).
ENV BACKEND_URL=http://backend:8080
COPY nginx.conf.template /etc/nginx/templates/default.conf.template
COPY index.html app.js art.js styles.css logo.svg wordmark.svg /usr/share/nginx/html/
EXPOSE 8080
