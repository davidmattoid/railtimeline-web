# RailTimeline Web · POC 0.1

Primera prueba de concepto de RailTimeline ejecutándose como aplicación web **local-first**, basada en la beta91 refactorizada.

## Qué funciona

- Catálogo real `default.rtlim.json` de beta91 (82 recorridos) embebido.
- Búsqueda y selección de surco, origen/destino parcial, US/UM, M1/M2 y ramas.
- Inicio/finalización de un servicio y persistencia del histórico en el navegador.
- Primera vista eBuLa construida con hitos + cambios de velocidad del catálogo.
- Navegación/confirmación manual de filas del eBuLa.
- Geolocation API y cálculo aproximado Línea/PK mediante las referencias IDEAdif que ya usa Android (2.590 puntos, líneas 010/018/030/040/042/046/048/050/054/066/072/080/354).
- Botón para alinear la fila eBuLa con el PK GPS más próximo.
- Importación del formato oficial de Habilitación (`FormatVersion: 1`).
- Carga y visualización de LIM/DHLTV en PDF, persistidos como Blob en IndexedDB.
- Importación de un `.rtlim.json` personalizado, también persistido en IndexedDB.
- Manifest + Service Worker para probar comportamiento PWA/offline.

## Qué NO intenta resolver todavía

- Parser PDF de DHLTV/LIM en navegador.
- LTV del DHLTV integradas en la secuencia eBuLa.
- Fusión de posicionamiento avanzada GNSS + velocidad + hitos/confirmaciones de Android.
- Turnos PDF, incidencias, PDF final de servicio, voz y sincronizaciones.
- Migración exacta de la base Room de Android.

## Cómo probarla

### Opción recomendada: localhost

Desde esta carpeta, si tienes Python instalado:

```powershell
py -m http.server 8080
```

Después abre:

`http://localhost:8080`

Esto permite Service Worker/PWA y es el modo más fiable para la Geolocation API.

### Abrir `index.html` directamente

La interfaz y la mayor parte de la POC funcionan también abriendo `index.html`, pero algunos navegadores restringen GPS y Service Workers en `file://`.

## Privacidad / arquitectura

La POC no realiza llamadas a APIs ni a un backend. El servidor HTTP, cuando se usa, solo entrega los archivos estáticos. Los datos de trabajo permanecen en `LocalStorage` e `IndexedDB` del navegador.
