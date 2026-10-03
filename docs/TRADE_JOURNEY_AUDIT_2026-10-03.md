# Auditoría Trade Journey — 3 octubre 2026

Base revisada: `dca09ce4123f118ea81fbacb81c29684fdc8c6ed` (main observado). Auditoría de código y pruebas locales con dependencias simuladas; no validación de producción ni consultas a la base real. La auditoría inicial no modificaba el motor ni la API; las reparaciones posteriores se detallan abajo.

## Reparaciones aplicadas después de la auditoría

- Identidad v2 basada en mint, firma de entrada y eventIndex; los aliases antiguos se aceptan sólo si resuelven exactamente un ciclo. IDs inexistentes/ambiguos devuelven null/404; valores vacíos o duplicados devuelven 400.
- El ranking oculta una fila legacy cuando está presente su equivalente v2; conserva ciclos v2 distintos del mismo segundo. La persistencia omite IDs duplicados y serializa fechas desconocidas como null.
- Orden por slot disponible; hold queda desconocido si falta una fecha en el volumen emparejado. Los cambios no inventan una duración a partir de un timestamp ausente.
- Normalización temporal explícita (segundos o ISO con zona); strings vacíos, booleanos y milisegundos no se convierten en 1970. Helpers puros en web/lib/tradeJourney.mjs.
- Página servidor resuelve params/searchParams y remonta el cliente por identidad. Fetch cancelable, respuestas obsoletas ignoradas, estado/error limpio, validación de wallet/mint/ID y normalización de eventos/metadatos.
- Siete tracks CSS; signos/colores coherentes. Etiquetas REALIZED COST / MATCHED PROCEEDS hacen explícita la semántica contable existente.
- Imagen exacta del usuario incluida como asset público en el botón global, conservando su enlace.
- Next.js 15.5.4 emitió una advertencia de vulnerabilidad durante instalación. Se actualizó dentro de la misma rama a 15.5.27, React/React DOM a 19.1.9 y se añadió lockfile. Referencias: https://nextjs.org/blog/CVE-2025-66478 y https://nextjs.org/blog/security-update-2025-12-11.

Verificación actual: 41 pruebas aprobadas, 0 TODO; build Next.js 15.5.27 aprobado. Smoke HTTP local: landing, beta, data y detalle responden 200 e incluyen el asset/enlace de Pump.fun; PNG responde 200 y coincide por SHA-256 con el adjunto; proxy reenvía journey, conserva 404 del backend simulado y rechaza claves vacías/duplicadas con 400. No equivale a validación visual: el navegador bloqueó localhost y monfluxo.com aún no está conectado (confirmado por el usuario); el entorno activo es GitHub/Railway. La sección de pruebas original más abajo describe el estado ANTES de estas reparaciones. No se cambió schema ni se ejecutó backfill en producción. El detalle aún reconstruye eventos y no promete un snapshot idéntico al ranking; si un backfill cambia el inicio del ciclo, un alias antiguo puede responder 404 de forma segura. Registros antiguos colisionados necesitan reconstrucción para recuperar el ciclo perdido. La paginación bajo escrituras concurrentes sigue siendo un límite documentado.

## Auditoría original (estado anterior a las reparaciones)

## Qué corrigieron los seis commits

| Commit | Archivo | Resultado y límite |
| --- | --- | --- |
| bbe7a615841d7197638ca214ea261500226e408b | web/app/data/trade/[wallet]/[mint]/page.js | Lee `journey` del URL, lo codifica y lo envía. Maneja respuestas no JSON. Corrige signos negativos textuales de PnL/ROI, pero mantiene la clase positiva. |
| 2dcefd69653f6ad7bb2ccb46a0944ea75ec804f6 | web/app/api/data/trade/[wallet]/[mint]/route.js | El proxy reenvía `journey`, conserva status y no-store. |
| 5838b23b2c08e6739612c031f3f627118d8b962b | src/httpApi.js | El backend pasa el parámetro a getTradeDetail. No cambia la selección dentro del servicio. |
| 59d01b7ab09df26c6f4380994bb626d05e9e5297 | página de detalle | Sustituye la combinación inválida dateStyle/timeStyle con timeZoneName por componentes explícitos. Comprueba Date inválida, admite ISO y muestra guion en valores ausentes. Añade protección de wallet, events y firmas ausentes. |
| 474df789a3e3222140e0c0ba652f090533fd2a7d | src/dataTradesService.js | Elimina getTokenSupply, búsquedas históricas SOL/USD y estimación por evento. Conserva motor, eventos y métricas financieras. Elimina campos de market cap del summary. |
| c89e5410594143fb80b30f8335f972d5d6cb0c2b | página de detalle | Elimina encabezado/celda Market cap y nota. No ajusta trade.css. |

Archivos relacionados revisados: src/tradeJourneyEngine.js, src/db.js, web/app/data/DataIntelligenceTables.js, trade.css, SocialLinks.js, social-links.css, layout.js y ambos package.json. El leaderboard ya incluye journeyId en sus enlaces.

## Hallazgos

### P1 — Journey inexistente devuelve otra operación (reproducido)

`getTradeDetail` selecciona `(journeyId && find(...)) || highestPnl`. Pedir un ID viejo, de otro token o mal escrito con eventos disponibles retorna 200 con otro ID. El camino completo transporta el ID, pero no garantiza identidad. Sin eventos devuelve null/404.

Recomendación: si el parámetro está presente, buscar exclusivamente ese ID y retornar null/404 si no existe. Aplicar fallback sólo cuando no hay parámetro; definir explícitamente si `?journey=` es inválido. Verificar wallet y mint del registro.

### P1 — IDs colisionan y pueden cambiar al completar el historial (colisión reproducida)

El motor usa `${tokenMint}:${entryTime || 0}`. Dos ciclos cerrados del mismo mint iniciados en el mismo segundo generan el mismo ID; find elige el primero. La persistencia hace upsert por wallet_address,journey_id, por lo que también existe riesgo de sobreescritura. Fechas desconocidas comparten el sufijo 0. Al ingresar una compra anterior durante backfill puede cambiar el inicio y dejar enlaces del ranking desactualizados.

El ranking lee wallet_trade_journeys persistido; el detalle reconstruye desde wallet_trades y NO lee el registro persistido exacto. Incluso con ID coincidente, los valores pueden divergir tras reparse/backfill. El título de bbe7a615 no implica que la resolución use una fila persistida.

Recomendación: identidad versionada con firma y eventIndex de la entrada; eventos/summary del mismo snapshot persistido, o contrato explícito de reconstrucción con versión y estado de sincronización. Planificar compatibilidad de URLs antiguas antes de cambiar IDs.

### P2 — Fechas vacías se convierten en 1970 (reproducido)

null, undefined, textos inválidos y fechas fuera de rango ya no tiran el formatter. Pero Number('') y Number('   ') son 0. Booleanos también se coercionan; valores en milisegundos se multiplican otra vez por 1000. Strings ISO sin zona dependen del huso horario.

Recomendación: aceptar sólo segundos Unix finitos o ISO con zona, rechazar strings vacíos y tipos ajenos. Definir unidades. Mantener zona visible. No inferir una fecha cuando falta.

### P2 — Hold desconocido se muestra como 0s (reproducido)

Sin timestamps, matchedTokens aumenta y holdingWeighted queda en cero, dando holdSeconds=0. Además, el orden trata timestamps ausentes como cero, por lo que un SELL sin fecha puede pasar antes de su BUY y ser descartado. slot/eventIndex sólo desempatan timestamps; el motor no usa signature para desempatar eventos indistinguibles aunque la DB sí lo hace.

Recomendación: distinguir duración conocida de volumen total emparejado; publicar null o cobertura parcial cuando faltan fechas. Definir orden por slot/eventIndex y desempate estable para fechas desconocidas.

### P2 — Estado cliente puede mostrar un journey anterior o un error permanente (inspección)

El useEffect no limpia d/err, cancela solicitudes ni ignora respuestas obsoletas. Cambiar A→B puede mostrar A con el URL de B y una respuesta lenta de A puede sobrescribir B. Después de un error, un fetch exitoso no borra err. React StrictMode puede duplicar solicitudes. Añadir AbortController o generation guard, reset de estado y pruebas con latencias controladas.

### P2 — Eventos parcialmente malformados todavía pueden romper el render (inspección)

Array.isArray protege el contenedor pero `events:[null]` llega a e.signature y lanza TypeError. Un JSON 200 truthy de forma equivocada se acepta como datos. Validar schema y elementos al recibir la respuesta, con fallback visible.

### P2 — Siete celdas con ocho columnas CSS (reproducido por inspección de tracks)

trade.css conserva ocho tracks y min-width:1040px. DEX y Tx ocupan los tracks anteriores de Market cap/DEX, dejando el último vacío y scroll innecesario. Actualizar a siete tracks y revisar ancho mínimo a 390, 768 y 1440 px. Las reglas .mcap-note/.muted quedaron sin uso en esta página.

### P2 — Presentación y semántica financiera pendientes (inspección)

PnL/ROI negativos siguen verdes; null puede verse como `+—`. Un ciclo abierto con ventas parciales expone costSol=realizedCost, no costo total comprado; el título INVESTED puede inducir a error. Venta mayor que inventario registra todo solAmount en el evento pero calcula summary.proceedsSol sólo para el volumen emparejado. Son riesgos previos, no causados por retirar market cap. Definir el contrato antes de modificar contabilidad.

### Rendimiento y datos parciales (inspección)

Quitar market cap elimina llamadas de suministro e históricos, pero conserva metadatos/perfil y lectura paginada de toda la wallet. Existe tope de 500000 filas sin marca de truncamiento. Paginación con offset durante nuevas inserciones puede alterar el conjunto leído. No hay garantía de snapshot compartido con el ranking.

## Pruebas ejecutadas

`node --test test/tradeJourneyAudit.test.js`

11 casos: 6 aprobados y 5 defectos reproducidos marcados TODO. Los TODO ejecutan assertions y fallan como se esperaba; el runner retorna 0 por la marca TODO. Esto NO significa que los 11 contratos estén corregidos. Retirar TODO al implementar cada corrección.

Validado localmente: ID existente elige ciclo de menor PnL con firmas correctas; URL legacy elige mayor PnL; formatter no falla con fechas ausentes/inválidas; segundos e ISO equivalen; proxy conserva encoding/status/no-store; quitar market cap preserva PnL/ROI/costo/proceeds/hold/eventos y no hace llamadas de reconstrucción.

Reproducido: ID inexistente sustituido, colisión de IDs, hold falso de 0s, fecha vacía en 1970, ocho tracks CSS.

Las pruebas usan el cuerpo real del servicio con imports sustituidos por stubs en vm, motor real y formatter extraído de la página. No son una suite completa de React/Next ni una prueba contra DB. La extracción del formatter es intencionalmente provisional; conviene exportar una utilidad pura al refactorizar.

## Matriz adicional de aceptación (pendiente de ejecución)

| Caso | Fixture / acción | Assertions concretas |
| --- | --- | --- |
| End-to-end de identidad | Una wallet y mint con ciclos A (+1 SOL) y B (+5 SOL); clicar A desde ranking | URL, proxy, backend y payload contienen A; firmas sólo de A; KPIs coinciden con el snapshot/version del ranking. Repetir B, recarga y enlace copiado. |
| ID inválido | Pedir inexistente, ID de otra wallet/mint, vacío, caracteres reservados y parámetro duplicado | Inexistente 404; no sustituir. Vacío/duplicado según contrato documentado; una sola decodificación; no 500. |
| Colisión y backfill | Dos ciclos en mismo segundo, eventIndex distintos; agregar BUY anterior y reparsear | IDs únicos y enlace estable o error explícito/versionado; no sobreescribir filas persistidas. |
| Paginación | 1001 eventos y ciclo cruzando página 1000; inserción durante lectura; superar tope | Sin firmas perdidas/duplicadas; orden estable; marcar truncamiento; no afirmar historial completo. |
| Timestamps | null, ausente, blanco, texto inválido, segundos, ISO Z/offset, milisegundos, booleano | Nunca crash ni 1970 artificial; ISO/segundos equivalentes; unidades rechazadas o normalizadas por contrato. |
| Orden / hold | SELL sin fecha pero slot posterior a BUY; todos sin fecha; mezcla parcial; empate de slot | Eventos no perdidos; duración desconocida no es cero; resultado estable al reordenar input. |
| Navegación concurrente | Respuesta A 800ms, B 50ms; cambiar A→B; error A seguido de B correcto; desmontar | Sólo B se muestra; loading adecuado; error limpio; ninguna actualización tardía. |
| Respuestas defectuosas | 404/500/502, HTML, JSON inválido, events null/[]/[null], token/perfil ausentes | Estado de error/vacío definido; ningún error JS; sin enlace de transacción sin firma. |
| Build | Ejecutar build de Next 15.5.4 con el árbol completo | Verificar prerender/useSearchParams y necesidad de Suspense según ruta; hidratación sin errores. |
| Market cap: API | Mismas fixtures contra pre/post 474df789, stub que prohíbe getTokenSupply y CoinGecko | Mismos KPIs, eventos, firma/orden/precio; sólo desaparecen campos de market cap; ninguna llamada retirada. Revisar todos los consumidores de esos campos. |
| Market cap: UI | Capturas 390/768/1440px con 0,1,100 eventos | Siete encabezados y celdas alineadas; DEX/Tx visibles; sin columna/nota market cap; scroll accesible; KPIs conservados. |
| Finanzas | Ciclo abierto, venta parcial, oversell, ROI null, PnL negativo | Contabilidad coherente y cobertura explícita; texto/signo/color apropiados; no `+—`. |
| Pump.fun | Botón global en landing/beta/data/detalle, teclado y móvil | Imagen adjunta visible sin deformarse; label accesible; href exacto https://pump.fun/join/Monfluxo; abre nueva pestaña con noopener noreferrer. |

## Imagen del botón

Se agrega `web/public/pumpfun-gold.png`, copia exacta del adjunto sin edición; SocialLinks.js sustituye la P por img decorativa de 28px, CSS usa object-fit:contain. Se conserva el enlace configurado https://pump.fun/join/Monfluxo y el nombre accesible. La titularidad/destino final de la cuenta no se verificó mediante login.

## Orden recomendado

1. Bloquear fallback de ID explícito y resolver identidad única/compatibilidad de registros persistidos.
2. Corregir estado de fetch, validación del payload, normalización temporal y hold desconocido.
3. Ajustar siete tracks, signos/colores y verificar capturas/build completo.
4. Ejecutar matriz end-to-end con snapshot del ranking antes de promover a producción.
