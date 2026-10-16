-- Datos FICTICIOS para probar a mano el envío completo (pantalla de costos → puente → MySQL 5.5) contra la base de PRUEBA local.
-- Se aplican con:  npm run mysql:prueba:datos      (borra y vuelve a crear solo estas cinco tablas; nunca toca la tarifa ni los cargos)
--
-- Lo que el puente exige que YA exista en Contratos antes de crear una oferta:
--   · el cliente (se busca por la base del NIT),
--   · el contador de ofertas de la (empresa, UEN),
--   · el concepto de facturación,
--   · y los horarios de los cargos.
-- El cliente de abajo es de mentira: para enviar una solicitud REAL de LiciColba agregue el suyo con su NIT «base-DV»:
--   docker compose -f test/mysql/docker-compose.yml exec -T mysql55 mysql -uroot -pprueba-root-local almacen_prueba -e "INSERT INTO fc_clientes (undnegocio, nit, sucursal, rsocial, snbasertf) VALUES ('BAQ','890102044-1','00','NOMBRE DEL CLIENTE','N')"
SET NAMES latin1;

DELETE FROM fc_clientes;
DELETE FROM fc_control;
DELETE FROM fc_conceptos;
DELETE FROM fc_horarios;
DELETE FROM fc_conceptos_costos_admtivos;
DELETE FROM act_subtipos;

INSERT INTO fc_clientes (undnegocio, nit, sucursal, rsocial, snbasertf) VALUES
  ('BAQ', '900123456-8', '00', 'CLIENTE DE PRUEBA S.A.S.', 'N');

-- num_oferta = el ULTIMO numero usado: la primera oferta de (01, BAQ) sera la 937.
INSERT INTO fc_control (empresa, undnegocio, num_oferta) VALUES
  ('01', 'BAQ', 936),
  ('01', 'BOG', 219),
  ('02', 'BAQ', 7);

INSERT INTO fc_conceptos (empresa, undnegocio, codcpto) VALUES
  ('01', 'BAQ', 'ASE'),
  ('01', 'BOG', 'ASE'),
  ('02', 'BAQ', 'VIG');

INSERT INTO fc_horarios (codigo, horario, snactivo) VALUES
  ('941', 'LUN-VIE 6-14', 1),
  ('942', 'LUN-SAB 14-22', 1);

INSERT INTO fc_conceptos_costos_admtivos (id, descripcion) VALUES
  (1, 'PÓLIZAS'), (2, 'IMPUESTOS'), (3, 'TRANSPORTE INSUMOS'), (4, 'SUPERVISIÓN - VISITAS'), (5, 'VIÁTICOS SUPERVISIÓN'),
  (6, 'PAPELERÍA Y OFICINAS'), (7, 'EXCEDENTE DE I.U.'), (8, 'PLANES DE DATOS'), (9, 'MANTENIMIENTO DE EQUIPOS'),
  (10, 'VALORES AGREGADOS CUANDO X OBLIGACION SE REQUIERA'), (11, 'OTROS');

-- El mismo subtipo puede estar bajo varios «Tipos» (así viene en la base viva): el puente prefiere la UEN de la oferta.
INSERT INTO act_subtipos (empresa_c, unidad_negocio_c, codtipo_c, codstipo_c, nombre_C, coddtipo) VALUES
  ('01', '', '004', '096', 'ASPIRADORA INDUSTRIAL', '004'),
  ('01', 'BAQ', '004', '096', 'ASPIRADORA INDUSTRIAL', '004'),
  ('01', '', '004', '171', 'VARA TELESCOPICA', '018'),
  ('01', '', '004', '171', 'VARA TELESCOPICA', '014');
