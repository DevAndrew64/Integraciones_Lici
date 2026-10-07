# Documentación técnica

> Los documentos históricos no deben utilizarse como fuente del estado
> actual del motor sin verificar el código y las pruebas vigentes.

## Motor de Mano de Obra

| Documento | Estado | Propósito |
|---|---|---|
| [`historico-mano-obra/DIAGNOSTICO_SOBRETIEMPOS_MANO_OBRA.md`](historico-mano-obra/DIAGNOSTICO_SOBRETIEMPOS_MANO_OBRA.md) | Histórico | Diagnóstico técnico del motor inline de `page.tsx` (código ya retirado) — trazabilidad del análisis que originó el Plan de unificación del motor comercial. |
| [`historico-mano-obra/FASE_0_LINEA_BASE_MANO_OBRA.md`](historico-mano-obra/FASE_0_LINEA_BASE_MANO_OBRA.md) | Vigencia parcial | Línea base de los tres motores de cálculo auditados (motor inline, `motor-mano-obra.ts`, `liquidador-mo.ts`). La sección sobre el motor inline de `page.tsx` es histórica; las observaciones sobre los demás módulos deben verificarse contra el código actual. |
| [`diseno-mano-obra/FASE_1A_1_DISENO_CONTEXTO_SEMANAL_MANO_OBRA.md`](diseno-mano-obra/FASE_1A_1_DISENO_CONTEXTO_SEMANAL_MANO_OBRA.md) | Diseño vigente | Diseño conceptual del modelo de contexto semanal (`PatronTrabajadorManoObra`, `ProgramacionDiariaTrabajador`, `ContextoSemanalManoObra`) — referenciado desde `src/lib/costos-mano-obra/contexto-semanal/enums.ts`. |
| [`diseno-mano-obra/FASE_1A_2_ESPECIFICACION_IMPLEMENTACION_CONTEXTO_SEMANAL.md`](diseno-mano-obra/FASE_1A_2_ESPECIFICACION_IMPLEMENTACION_CONTEXTO_SEMANAL.md) | Diseño vigente | Especificación técnica de implementación (campos, tipos, enums, contratos) del contexto semanal — referenciado desde el mismo `enums.ts`. |

## Otros documentos en `docs/`

- [`api-publica-indicadores-procesos.md`](api-publica-indicadores-procesos.md) — contrato de la API pública de indicadores.
- `diseno-formulario-requisito-mo.md`
- `diseno-funcional-mano-obra-ia.md`
- `plan-implementacion-mano-obra.md`