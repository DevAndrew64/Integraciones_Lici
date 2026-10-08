# Carga la COPIA de producción (volcados por tabla, «Respaldo generado…») en la base almacen_copia del MySQL 5.5 de PRUEBA.
# Corre dentro del contenedor `copia` (imagen mysql:5.5); la carpeta con los .sql llega montada, de solo lectura, en /copia
# (variable COPIA_SQL_DIR; las subcarpetas no importan). Solo imprime conteos: nunca filas.
#
#  - Cada tabla se carga TAL CUAL viene en su volcado (estructura real y datos); las demás tablas del contrato de esquema
#    quedan con la estructura de test/mysql/esquema.sql, sin datos.
#  - fc_empresas y fc_control NO se cargan: guardan usuario y clave de conexión. Los contadores de oferta se derivan de la
#    mayor oferta de la tarifa por (empresa, UEN) (en Contratos hay además filas sin ofertas todavía).
set -eu

BD=almacen_copia
TABLAS="gl_undnegocios fc_clientes fc_conceptos fc_horarios fc_contratos_tarifa_inicial fc_contratos_cargos_iniciales"
root() { mysql -hmysql55 -uroot -pprueba-root-local "$@"; }
volcado() { find /copia -type f -name "$1.sql" | head -n 1; }

# Todos los volcados deben estar ANTES de tocar nada.
faltan=""
for t in $TABLAS; do
  [ -n "$(volcado "$t")" ] || faltan="$faltan $t.sql"
done
if [ -n "$faltan" ]; then
  echo "ERROR: en la carpeta de la copia (COPIA_SQL_DIR) no encuentro:$faltan" >&2
  echo "Defina COPIA_SQL_DIR con la carpeta que contiene los .sql (las subcarpetas no importan). No se tocó ninguna base." >&2
  exit 1
fi

echo "Preparando $BD (latin1) con la estructura de Contratos..."
# Se vacían las TABLAS, no la base: así un puente que ya esté corriendo contra ella sigue funcionando sin reiniciarlo.
root -e "CREATE DATABASE IF NOT EXISTS $BD DEFAULT CHARACTER SET latin1"
for existente in $(root -N -e "SHOW TABLES" "$BD"); do
  root -e "DROP TABLE $existente" "$BD"
done
root --default-character-set=latin1 "$BD" < /esquema.sql

echo "Cargando los volcados (los .sql traen SET NAMES utf8; las tablas siguen en latin1, como en Contratos)..."
for t in $TABLAS; do
  root --default-character-set=utf8 "$BD" < "$(volcado "$t")"
  printf '  %-34s %s filas\n' "$t" "$(root -N -e "SELECT COUNT(*) FROM $t" "$BD")"
done

root "$BD" -e "
  DELETE FROM fc_control;
  INSERT INTO fc_control (empresa, undnegocio, num_oferta)
  SELECT empresa, undnegocio, MAX(num_oferta) FROM fc_contratos_tarifa_inicial
   WHERE CHAR_LENGTH(empresa) BETWEEN 1 AND 2 AND CHAR_LENGTH(undnegocio) BETWEEN 1 AND 3
   GROUP BY empresa, undnegocio"
printf '  %-34s %s contadores (empresa, UEN), derivados de la tarifa\n' fc_control "$(root -N -e 'SELECT COUNT(*) FROM fc_control' "$BD")"

# El usuario del puente de prueba ya existe (lo crea la imagen); aquí solo recibe permisos sobre la base nueva.
root -e "GRANT ALL PRIVILEGES ON $BD.* TO 'puente'@'%'"
echo "Copia cargada en la base $BD. Siguiente: levantar el puente contra ella (ver el README, «Probarlo con la copia de producción»)."
