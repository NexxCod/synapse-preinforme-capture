# Synapse Preinforme Capture

Extensión de Chrome que registra automáticamente tus preinformes de Synapse CWM en una planilla personal de Google Sheets. También obtiene el informe final validado por el staff, así puedes comparar ambos lado a lado.

**No cambia nada de tu flujo de trabajo.** Se instala una sola vez y funciona automáticamente cada vez que haces "Enviar a" en Synapse.

---

## ¿Qué hace?

Cada vez que envías un preinforme a validación en Synapse, la extensión captura automáticamente:

- Fecha y hora del envío
- Datos del paciente (nombre, RUT, N° de acceso)
- Procedimiento(s) y fecha del examen
- Staff al que enviaste el estudio
- Texto completo de tu preinforme
- Informe final validado (se obtiene después de la validación)

Todo queda en tu planilla personal de Google Sheets. El preinforme y el informe final quedan en la misma fila para que puedas comparar fácilmente.

---

## Instalación (5 minutos)

### Paso 1 — Descargar

Haz click en el botón verde **"Code"** (arriba en esta página) → **"Download ZIP"**.

Descomprime el ZIP en una carpeta que no vayas a borrar (por ejemplo, en Documentos).

### Paso 2 — Abrir extensiones de Chrome

Escribe esto en la barra de direcciones de Chrome y presiona Enter:

```
chrome://extensions
```

### Paso 3 — Activar modo desarrollador

En la esquina **superior derecha** de la página, activa el switch que dice **"Modo de desarrollador"**.

### Paso 4 — Cargar la extensión

Haz click en **"Cargar descomprimida"** (botón que aparece arriba a la izquierda).

Navega hasta la carpeta que descomprimiste y selecciona la carpeta **`extension`** (la que contiene `manifest.json`, `content.js`, `background.js`, etc.).

### Paso 5 — Verificar

La extensión aparece en la lista con el ícono rojo **"S"**. Puedes hacer click en el ícono en la barra de Chrome para ver el panel de estado.

Ahora abre un estudio en Synapse, escribe un preinforme y haz "Enviar a" como siempre. Debería aparecer brevemente una notificación verde **"✓ Preinforme capturado"** en la esquina superior derecha.

---

## ¿Cómo obtengo los informes finales?

Los informes finales validados por el staff no se capturan automáticamente al momento del envío (porque aún no existen). Se obtienen después, cuando el staff ya validó el estudio.

Para obtenerlos:

1. Haz click en el ícono de la extensión (la **"S"** roja en la barra de Chrome)
2. Presiona el botón **"Obtener informes finales"**
3. La extensión revisa cuáles de tus preinformes aún no tienen informe final, los busca en Synapse y los agrega a la planilla

Puedes presionar este botón cuando quieras — los estudios que aún no estén validados simplemente se saltan y puedes volver a intentarlo después.

---

## ¿Cómo veo mis preinformes?

Te voy a compartir una planilla personal de Google Sheets a tu correo. Ahí van a ir apareciendo automáticamente todos tus preinformes con los datos del estudio.

Si quieres que te active la planilla, escríbeme.

---

## Preguntas frecuentes

**¿Tengo que hacer algo cada vez que abro Chrome?**
No. La extensión se ejecuta sola cuando entras a Synapse.

**¿Cambia algo en Synapse?**
No. El envío funciona exactamente igual. La extensión solo lee los datos y los guarda aparte.

**¿Funciona en Edge?**
Sí, el mismo proceso de instalación funciona en Microsoft Edge.

**¿Funciona si actualizo Chrome?**
Sí. Puede que Chrome muestre un aviso de "extensiones en modo desarrollador" al abrir el navegador — solo ciérralo y sigue.

**¿Puedo desinstalarla?**
Sí, en `chrome://extensions` haz click en "Quitar".

**¿Quién puede ver mis preinformes?**
Solo tú tienes acceso a tu planilla personal.

---

## Contacto

Cualquier duda o problema con la extensión, escríbeme.

**Marcelo Salinas Villagra** — Imagenología, HSJD
marcelo.salinas@mail.udp.cl
