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
