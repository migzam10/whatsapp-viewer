# WhatsApp Chat Viewer

Visor de chats exportados de WhatsApp, 100 % en el navegador. Carga el `.txt`
(o el `.zip` con multimedia) y lo muestra con la estética de WhatsApp: burbujas,
separadores de fecha, avatares de grupo, búsqueda y estadísticas.

> 🔒 **Privacidad:** todo el procesamiento ocurre en tu navegador. Ningún archivo
> ni mensaje se sube a ningún servidor.

## Características

- **Soporta los 3 formatos de exportación** de WhatsApp sin perder ninguno:
  - Antiguo: `15/1/2025, 12:22 - Nombre: mensaje` (24 h)
  - Celular nuevo: `25/03/26, 2:22 p. m. - Nombre: mensaje` (am/pm)
  - Web / iOS: `[25/03/26, 2:22:09 p. m.] Nombre: mensaje` (corchetes)
- **Multimedia real** desde un `.zip` o una carpeta exportada «con multimedia»:
  imágenes, audios (notas de voz), videos y stickers se renderizan inline.
- **Búsqueda** dentro de la conversación con resaltado y navegación (▲ ▼).
- **Selector de “yo”**: toca un participante para marcar tus mensajes a la derecha.
- **Tema claro / oscuro** (se recuerda).
- Detección de **mensajes editados / eliminados**, enlaces clicables, grupos
  e individuales, nombres con guiones, no-contactos (`~`) y números de teléfono.

## Uso

1. En WhatsApp: **Conversación → Más opciones → Exportar chat**.
   - Elige **«Con multimedia»** para ver fotos/audios (genera un `.zip`).
   - O **«Sin multimedia»** para solo texto (genera un `.txt`).
2. Abre `index.html` en el navegador.
3. Arrastra el `.txt`/`.zip`, o usa **Seleccionar archivo** / **Cargar carpeta**
   (si ya descomprimiste el export).

No requiere instalación ni servidor. La única dependencia externa es
[JSZip](https://stuk.github.io/jszip/) (vía CDN) para leer los `.zip`.

## Estructura

| Archivo      | Qué hace                                                       |
|--------------|----------------------------------------------------------------|
| `index.html` | Estructura de la UI                                            |
| `app.js`     | Parser de los formatos, carga de archivos, render y búsqueda  |
| `style.css`  | Estilos + temas claro/oscuro                                  |
