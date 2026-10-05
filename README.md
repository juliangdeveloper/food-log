# food-log

Bitácora de comidas estática (vanilla JS, interfaz en es-CO) para GitHub Pages. No hay servidor ni bundler: `index.html` carga `js/app.js` como módulo y los recursos usan rutas relativas.

## Almacenamiento (v0.2.0)

La bitácora sigue en `localStorage`, clave `food-log.save.v1`. Las bitácoras nuevas usan `schema_version` 2. Las fotos no van en ese JSON: se guardan como `Blob` original (los bytes del archivo, sin recomprimir ni redimensionar) en IndexedDB, base `food-log`, almacén `photos`, con [`idb-keyval`](js/vendor/idb-keyval.js) 6.3.0. La clave es `img:<id de la entrada>`.

Al abrir la app, una bitácora `schema_version` 1 migra cada `image_data_url`. El data URL solo se quita después de escribir el blob, leerlo y comprobar que el tamaño y el tipo coinciden. Si el proceso se interrumpe, el siguiente arranque continúa. Si IndexedDB no está disponible, las fotos siguen como data URL en `localStorage`.

El JSON de respaldo lleva las fotos (data URL de esos mismos bytes) para poder moverlas a otro navegador. Al importarlo, vuelven a IndexedDB. Borrar una comida también borra su foto.

En Ajustes se indica si el almacenamiento del sitio es persistente y, cuando el navegador lo permite, el uso aproximado. En iPhone y Safari, los datos de un sitio que no se usa durante 7 días pueden borrarse, salvo que la app esté en la pantalla de inicio.

Los ID de las hojas (`overrides_file_id` y `meals.file_id`) siguen siendo solo punteros. food-log no lee Drive ni sube fotos.
