-- Verificación de una oferta adjudicada creada por el puente (solo consultas SELECT: no cambia nada).
-- Base: almacen (la base de Contratos). Si el puente escribió en la copia local de Docker, cambie el USE por almacen_copia o
-- almacen_prueba. Cambie también las tres variables de la línea siguiente.
USE almacen;
SET @empresa = '01', @uen = 'BAQ', @oferta = 937;   -- lo que dijo la pantalla de LiciColba: «Oferta 937 creada (empresa 01, UEN BAQ)»

-- 1. La oferta adjudicada: debe devolver 1 fila, con user_add LICICOLBA y la marca de la solicitud en pc_add.
SELECT id, empresa, undnegocio, num_oferta, nit, rsocial, vlr_adjudicado, vlr_manoobra, vlr_insumos, vlr_maquinaria,
       vlr_impuestos, vlr_otros, vlr_nocontinuos, user_add, fadd, pc_add
  FROM fc_ofertas_adjudicadas
 WHERE empresa = @empresa AND undnegocio = @uen AND num_oferta = @oferta;

-- 2. Su lista de precios de insumos (módulo 6): una fila por código de elemento, con costo, A.I.U. y precio de venta.
SELECT codigo, vr_costo, aiu, valor, cliente, nom_punto, user_add, fadd
  FROM fc_preciosventas_oferta
 WHERE undnegocio = @uen AND num_oferta = @oferta AND user_add = 'LICICOLBA'
 ORDER BY id;

-- 3. ¿Está bien asociada? El cliente debe existir, el contador no puede ir por debajo del número y el adjudicado debe cuadrar.
SELECT a.num_oferta,
       (SELECT COUNT(*) FROM fc_clientes c WHERE TRIM(c.nit) = TRIM(a.nit)) AS cliente_en_fc_clientes,
       (SELECT n.num_oferta FROM fc_control n WHERE n.empresa = a.empresa AND n.undnegocio = a.undnegocio) AS contador_actual,
       (SELECT COUNT(*) FROM fc_preciosventas_oferta p WHERE p.undnegocio = a.undnegocio AND p.num_oferta = a.num_oferta AND p.user_add = 'LICICOLBA') AS precios_de_insumos,
       (a.vlr_adjudicado = a.vlr_manoobra + a.vlr_insumos + a.vlr_maquinaria + a.vlr_impuestos + a.vlr_otros + a.vlr_nocontinuos) AS adjudicado_es_la_suma_de_sus_6_partes
  FROM fc_ofertas_adjudicadas a
 WHERE a.empresa = @empresa AND a.undnegocio = @uen AND a.num_oferta = @oferta;

-- 4. Todo lo que ha escrito el puente (las más recientes primero).
SELECT empresa, undnegocio, num_oferta, nit, vlr_adjudicado, fadd, pc_add
  FROM fc_ofertas_adjudicadas
 WHERE user_add = 'LICICOLBA'
 ORDER BY id DESC
 LIMIT 20;
