# Static site with nginx
FROM nginx:alpine

# Copy nginx configuration
COPY nginx.conf /etc/nginx/nginx.conf

# Copy static files
COPY dist/ /usr/share/nginx/html/

# Create non-root user
RUN addgroup -g 1001 -S nginx-user && \
    adduser -S -u 1001 nginx-user && \
    chown -R nginx-user:nginx-user /usr/share/nginx/html

EXPOSE 8080

CMD ["nginx", "-g", "daemon off;"]
