# MONFLUXO: prueba de costos por historial — 2026-10-03

Wallet: `8MaVa9kdt3NW4Q5HyNAm1X5LbR8PQRVDc1W8NMVK88D5`. Prueba en Railway/Supabase de producción, con la configuración actual de 100 transacciones por página. Orden: más recientes primero, exitosas, incluyendo token accounts balanceChanged. Límite final 12.000; no se descargó el resto. Se conserva el cursor y el estado parcial.

## Resultados medidos

| Bloque nuevo | Tiempo de job, descarga + análisis | Páginas | Créditos de historial calculados | JSON recibido sin comprimir | CPU de páginas |
|---|---:|---:|---:|---:|---:|
| 1–5.000 | 72,31 s | 50 | 500 | 72,51 MB | 5,17 s |
| 5.001–10.000 | 76,58 s | 50 | 500 | 71,99 MB | 5,06 s |
| 10.001–12.000 | 29,60 s | 20 | 200 | Ver evidencia | Ver evidencia |

Los tiempos excluyen espera de cola y la posterior carga de interfaz. El segundo bloque continúa desde el cursor; se recalcula contabilidad usando el historial acumulado, no se calcula PnL aislado sin inventario anterior. No hubo metadata externa en el análisis del worker.

Almacenamiento lógico medido con sum(pg_column_size(row)), incluyendo caché, policy y estado: 57.472 bytes a 5.000, 58.480 a 10.000 y 69.744 a 12.000. No incluye índices, páginas libres, WAL, backups ni overhead físico. El tamaño global de la DB creció unos 65 KB durante la ventana; no es una atribución exacta al wallet, pues la DB es compartida.

Trades guardados: 55 a 5.000, 55 a 10.000, 72 a 12.000. Es una muestra de baja densidad económica; no extrapolar estos bytes a wallets con 5.000 swaps. Raw transaction payloads: 0. Historial completo: false. El costo se cobra por trabajo descargado, no por cantidad de trades retenidos.

## API y costo aproximado

Historial: 10 créditos por 100 transacciones devueltas. Cada bloque de 5.000 equivale a 500 créditos; total histórico de la prueba 1.200. Son créditos estimados según páginas registradas y tarifa oficial, no un extracto de factura Helius.

Interfaz observada: 840 activos live y 59 mints distintos en la respuesta. Una carga fría de esos 59 mints puede sumar hasta 590 créditos DAS, más 10 por holdings. Total orientativo de indexación + esa carga: 500–1.100 créditos por primer bloque. Metadata cacheada reduce el trabajo; imágenes/paneles adicionales, Identity y nuevas actualizaciones pueden añadir llamadas. No se midió el contador de facturación global Helius por request, ni se atribuyen consultas auxiliares como exactas.

Free actual: US$0 por los créditos incluidos. Developer futuro: 49/10.000.000 = US$0,0000049 por crédito como reparto de capacidad, no tarifa marginal. Historial de 5.000: US$0,00245. Historial + carga fría modelada: hasta US$0,00539.

Railway usa CPU/tiempo de RAM y egress. Las páginas consumieron aproximadamente 5 segundos CPU, RSS máximo 0,117–0,118 GB y 72–77 segundos de job. El cálculo parcial CPU + RSS máximo durante el job ronda US$0,00007; no mide todos los recursos del contenedor, kernel, metadata, API e imágenes. Presupuesto conservador para ejecución + tráfico de un análisis con interfaz: US$0,001–0,003, estimado, pendiente de reconciliar con factura. Los ~72 MB de JSON son entrada en Railway: no deben cobrarse como egress Railway.

Supabase Pro: coste incremental por estos registros ~US$0 mientras se mantengan cuotas de 8 GB disk y 250 GB egress. DB actual ~1,42 GB de tamaño de base; disco facturable incluye otros componentes. No hay cobro SQL por cada transacción. Una vez excedidas cuotas: US$0,125/GB-mes disk y US$0,09/GB egress.

Para planificación con Developer, presupuestar US$0,01 por bloque de 5.000 como margen de recursos/API; no es costo medido exacto ni incluye el reparto de infraestructura inactiva, soporte o pagos. Bajo Free/cuotas incluidas, el cargo adicional puede ser US$0; no significa que operar el producto sea gratis.

## Repartir mensualidades sin doble conteo

Usuario confirmó Railway Hobby US$5 y Supabase Pro US$25; Helius aún Free. Base mensual US$30, con consumo Railway incluido hasta US$5. Factura modelada: 25 + max(5, recursos_Railway) + sobreconsumos_Supabase. Si Helius Developer: sumar 49; base US$79. No sumar de nuevo el costo normalizado de créditos incluidos a la mensualidad completa.

| Bloques de 5.000/mes | US$30 repartidos | US$79 repartidos |
|---|---:|---:|
| 100 | US$0,30 | US$0,79 |
| 1.000 | US$0,03 | US$0,079 |

Estos son repartos de base, no garantizan capacidad ni cuotas. Sumarlos a sobreconsumos reales; cuotas y carga de metadata deben controlarse. No pudimos leer facturas mensuales ni confirmar consumo restante desde los conectores.

## Créditos MONFLUXO

Mantener por ahora: 3 créditos iniciales hasta 5.000 transacciones; 1 crédito por cada 2.000 adicionales. Totales acumulados: 5.000=3, 10.000=6, 12.000=7. Aplicar ceil una sola vez al consumo acumulado; no volver a redondear cada continuación. Pro inicial: 30/mes (hasta 10 análisis nuevos de 5.000), revisable con cohortes y concurrencia. Nunca descontar por un fallo sin trabajo guardado; cobrar ampliación por transacciones nuevas, no por volver a abrir el mismo snapshot.

Validar al menos 10 wallets con distintas densidades económicas y holdings antes de fijar límites definitivos. Reutilizar metadata y snapshots resulta más útil para coste que ahorrar únicamente HTTP de historial. La llamada de 1.000 reduce peticiones, no los 500 créditos de 5.000 resultados.

## Reparación descubierta

La primera petición falló por transacciones versión 1. Se actualizó maxSupportedTransactionVersion a 1 y se añadieron métricas por página; la prueba retomó desde cero y terminó. El fallo Helius no devuelve páginas facturables. La instrumentación quedó validada con 89 tests. La corrección se desplegó en API y worker.

## Fuentes de tarifas

- https://www.helius.dev/docs/rpc/gettransactionsforaddress
- https://www.helius.dev/docs/billing/credits
- https://docs.railway.com/pricing/plans
- https://supabase.com/docs/guides/platform/billing-on-supabase

Evidencia agregada y métricas por página: cost-benchmark-2026-10-03.json.
