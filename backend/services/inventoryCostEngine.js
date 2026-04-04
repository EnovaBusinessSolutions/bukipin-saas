function num(v, def = 0) {
  if (v === null || typeof v === "undefined") return def;
  if (typeof v === "number") return Number.isFinite(v) ? v : def;
  const s = String(v).trim();
  if (!s) return def;
  const n = Number(s.replace(/[$,\s]/g, ""));
  return Number.isFinite(n) ? n : def;
}

function pickStock(product) {
  return num(product?.stockActual ?? product?.stock_actual ?? product?.stock ?? 0, 0);
}

function pickAvgCost(product) {
  return num(
    product?.costoPromedio ?? product?.costo_promedio ?? product?.costoPromedioPonderado ?? product?.costoCompra ?? 0,
    0
  );
}

function pickInventoryValue(product) {
  const direct = num(
    product?.valorInventarioActual ??
      product?.valor_inventario_actual ??
      product?.inventoryValueRunning ??
      Number.NaN,
    Number.NaN
  );

  if (Number.isFinite(direct)) return direct;

  return Number((pickStock(product) * pickAvgCost(product)).toFixed(6));
}

function applyEntrada({ stockActual, costoPromedio, valorInventarioActual, unidades, costoCompra }) {
  const stock = num(stockActual, 0);
  const avg = num(costoPromedio, 0);
  const qty = Math.abs(num(unidades, 0));
  const unit = Math.abs(num(costoCompra, 0));

  const valorAntes = num(valorInventarioActual, Number.NaN);
  const totalAnterior = Number.isFinite(valorAntes) ? valorAntes : stock * avg;

  const totalNuevo = qty * unit;
  const stockDespues = Number((stock + qty).toFixed(6));
  const valorInventarioDespues = Number((totalAnterior + totalNuevo).toFixed(6));
  const costoPromedioDespues =
    stockDespues !== 0 ? Number((valorInventarioDespues / stockDespues).toFixed(6)) : avg;

  return {
    stockAntes: stock,
    stockDespues,

    costoPromedioAntes: avg,
    costoPromedioDespues,

    valorInventarioAntes: Number(totalAnterior.toFixed(6)),
    valorInventarioDespues,

    unidadesEntrada: qty,
    costoCompraUnitario: unit,
  };
}

function computeSaleCost({
  stockActual,
  costoPromedio,
  valorInventarioActual,
  unidades,
  costoProvisionalManual,
}) {
  const stock = num(stockActual, 0);
  const avg = num(costoPromedio, 0);
  const qty = Math.abs(num(unidades, 0));
  const provisional = num(costoProvisionalManual, Number.NaN);
  const costoProvisional = Number.isFinite(provisional) && provisional > 0 ? provisional : avg;

  const unidadesConStock = Math.max(0, Math.min(qty, stock));
  const unidadesSinStock = Math.max(0, qty - unidadesConStock);

  const costoTotal = Number(
    (unidadesConStock * avg + unidadesSinStock * Math.max(costoProvisional, 0)).toFixed(2)
  );

  const valorAntes = num(valorInventarioActual, Number.NaN);
  const valorInventarioAntes = Number.isFinite(valorAntes) ? valorAntes : stock * avg;
  const valorInventarioDespues = Number((valorInventarioAntes - costoTotal).toFixed(6));

  return {
    stockAntes: stock,
    stockDespues: Number((stock - qty).toFixed(6)),

    costoPromedioAntes: avg,
    costoPromedioDespues: avg, // regla de negocio: vender no cambia promedio visible

    valorInventarioAntes: Number(valorInventarioAntes.toFixed(6)),
    valorInventarioDespues,

    unidadesVenta: qty,
    unidadesConStock,
    unidadesSinStock,
    costoProvisional,

    costoUnitarioAplicado: qty > 0 ? Number((costoTotal / qty).toFixed(6)) : 0,
    costoTotal,
  };
}

module.exports = {
  num,
  pickStock,
  pickAvgCost,
  pickInventoryValue,
  applyEntrada,
  computeSaleCost,
};
