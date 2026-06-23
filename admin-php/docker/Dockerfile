# Local dev/verification image only. Production target is cPanel shared hosting.
FROM php:8.2-apache

RUN apt-get update && apt-get install -y --no-install-recommends \
        libzip-dev libpng-dev libjpeg-dev libonig-dev unzip \
    && docker-php-ext-configure gd --with-jpeg \
    && docker-php-ext-install pdo_mysql zip gd mbstring \
    && a2enmod rewrite \
    && rm -rf /var/lib/apt/lists/*

# Note: dom, xml, simplexml, libxml are already bundled in the official php image.

# Larger uploads (issue PDFs up to ~500MB in the Node panel)
RUN { \
      echo 'upload_max_filesize = 512M'; \
      echo 'post_max_size = 512M'; \
      echo 'memory_limit = 512M'; \
      echo 'max_execution_time = 300'; \
    } > /usr/local/etc/php/conf.d/uploads.ini

COPY vhost.conf /etc/apache2/sites-available/000-default.conf
