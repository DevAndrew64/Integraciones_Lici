-- Verificación de una oferta creada por el puente (solo consultas SELECT: no cambia nada).
-- Base: almacen, la copia de producción de la intranet (README, «Probarlo contra el MySQL de la intranet»). Si el puente escribió en
-- la copia local de Docker, cambie el USE por almacen_copia. Cambie también las tres variables de la línea siguiente.
USE almacen;
SET @empresa = '01', @uen = 'BAQ', @oferta = 937;   -- lo que dijo la pantalla de LiciColba: «Oferta 937 creada (empresa 01, UEN BAQ)»

-- 1. La oferta (cabecera): debe devolver 1 fila, con user_add LICICOLBA y la marca de la solicitud en pc_add.
SELECT id, empresa, undnegocio, num_oferta, nit, rsocial, codservicio, tipo_adm, origen_proceso, aiu,
       tarifa, tar_manoobra, tar_insumos, tar_maquinaria, tar_impuestos, tar_otros, tar_nocontinuos,
       user_add, fadd, pc_add
  FROM fc_contratos_tarifa_inicial
 WHERE empresa = @empresa AND undnegocio = @uen AND num_oferta = @oferta;

-- 2. Sus cargos: una fila por línea, con la misma clave (empresa, UEN, oferta) y el horario de cada uno.
SELECT item, cargo, nom_cargo, cantidad, horassem, jornada, salario, riesgo, vlr_unitario, vlr_total, codhorario, concepto, user_add
  FROM fc_contratos_cargos_iniciales
 WHERE empresa = @empresa AND undnegocio = @uen AND num_oferta = @oferta
 ORDER BY item;

-- 3. ¿Está bien asociada? Cada columna debe dar 1 (o más), el contador no puede ir por debajo del número y la tarifa debe cuadrar.
SELECT t.num_oferta,
       (SELECT COUNT(*) FROM fc_clientes c WHERE TRIM(c.nit) = TRIM(t.nit)) AS cliente_en_fc_clientes,
       (SELECT COUNT(*) FROM fc_conceptos k WHERE k.empresa = t.empresa AND k.undnegocio = t.undnegocio AND k.codcpto = t.codservicio) AS concepto_en_fc_conceptos,
       (SELECT n.num_oferta FROM fc_control n WHERE n.empresa = t.empresa AND n.undnegocio = t.undnegocio) AS contador_actual,
       (SELECT COUNT(*) FROM fc_contratos_cargos_iniciales g WHERE g.empresa = t.empresa AND g.undnegocio = t.undnegocio AND g.num_oferta = t.num_oferta) AS cargos,
       (SELECT COUNT(*) FROM fc_contratos_cargos_iniciales g WHERE g.empresa = t.empresa AND g.undnegocio = t.undnegocio AND g.num_oferta = t.num_oferta
           AND g.codhorario IS NOT NULL AND g.codhorario <> '' AND NOT EXISTS (SELECT 1 FROM fc_horarios h WHERE h.codigo = g.codhorario)) AS cargos_con_horario_inexistente,
       (t.tarifa = t.tar_manoobra + t.tar_insumos + t.tar_maquinaria + t.tar_impuestos + t.tar_otros + t.tar_nocontinuos) AS tarifa_es_la_suma_de_sus_6_partes
  FROM fc_contratos_tarifa_inicial t
 WHERE t.empresa = @empresa AND t.undnegocio = @uen AND t.num_oferta = @oferta;

-- 4. ¿Cuadra la mano de obra? Los cargos (sin A.I.U.) × (1 + A.I.U.) deben dar la mano de obra de la tarifa; la diferencia es solo redondeo.
SELECT SUM(g.vlr_total) AS cargos_sin_aiu,
       ROUND(SUM(g.vlr_total) * (1 + t.aiu)) AS cargos_con_aiu,
       t.tar_manoobra AS mano_obra_de_la_tarifa,
       ROUND(SUM(g.vlr_total) * (1 + t.aiu)) - t.tar_manoobra AS diferencia
  FROM fc_contratos_cargos_iniciales g
  JOIN fc_contratos_tarifa_inicial t ON t.empresa = g.empresa AND t.undnegocio = g.undnegocio AND t.num_oferta = g.num_oferta
 WHERE g.empresa = @empresa AND g.undnegocio = @uen AND g.num_oferta = @oferta
 GROUP BY t.id;

-- 5. ¿Se ve igual que las ofertas hechas a mano en Contratos? Las anteriores (hasta 2; pc_add trae el equipo de quien la digitó).
SELECT num_oferta, nit, codservicio, tipo_adm, origen_proceso, aiu, tarifa, tar_manoobra, tar_impuestos, user_add, fadd, pc_add
  FROM fc_contratos_tarifa_inicial
 WHERE empresa = @empresa AND undnegocio = @uen AND num_oferta BETWEEN @oferta - 2 AND @oferta
 ORDER BY num_oferta;

-- 6. Lo que el puente todavía NO escribe (módulos 6 y 7): para esta oferta deben dar 0 filas en estas tablas.
SELECT 'fc_contratos_equipos_iniciales' AS tabla, COUNT(*) AS filas FROM fc_contratos_equipos_iniciales WHERE empresa = @empresa AND undnegocio = @uen AND num_oferta = @oferta
UNION ALL SELECT 'fc_contratos_costos_admtivos_iniciales', COUNT(*) FROM fc_contratos_costos_admtivos_iniciales WHERE empresa = @empresa AND undnegocio = @uen AND num_oferta = @oferta
UNION ALL SELECT 'fc_contratos_no_continuos_iniciales', COUNT(*) FROM fc_contratos_no_continuos_iniciales WHERE empresa = @empresa AND undnegocio = @uen AND num_oferta = @oferta
UNION ALL SELECT 'fc_contratos_vlrs_agregs_iniciales', COUNT(*) FROM fc_contratos_vlrs_agregs_iniciales WHERE empresa = @empresa AND undnegocio = @uen AND num_oferta = @oferta
UNION ALL SELECT 'fc_elemxcont', COUNT(*) FROM fc_elemxcont WHERE empresa = @empresa AND undnegocio = @uen AND num_oferta = @oferta
UNION ALL SELECT 'fc_preciosventas_oferta', COUNT(*) FROM fc_preciosventas_oferta WHERE undnegocio = @uen AND num_oferta = @oferta;
