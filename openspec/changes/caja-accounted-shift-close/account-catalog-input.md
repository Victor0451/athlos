# User-supplied chart input

This is the user's requested seed content, recovered from the conversation, not a new request for the user to repeat it. Names remain Spanish. Five-root dotted hierarchy is approved; final leaf suffixes and automatic production bindings are design proposals pending review, not missing user category input. CRUD is deferred. This is not a claim of certified FACPCE compliance.

| Group code | Group | Requested leaves |
| --- | --- | --- |
| 1 | Activo | Group only |
| 1.1 | Activo Corriente | Group only |
| 1.1.1 | Caja y Bancos | Caja (Pesos); Caja Moneda Extranjera; Fondo Fijo (Caja Chica); Banco X Cuenta Corriente |
| 1.1.2 | Inversiones | Plazo Fijo; Fondos Comunes de Inversión (FCI) |
| 1.1.3 | Créditos por Ventas | Deudores por Ventas; Valores a Depositar; Deudores Morosos; Tarjetas de Crédito a Cobrar |
| 1.1.4 | Otros Créditos | IVA Crédito Fiscal; Retenciones/Percepciones sufridas (IVA, Ingresos Brutos, Ganancias); Anticipos a Proveedores |
| 1.1.5 | Bienes de Cambio | Mercaderías; Materias Primas |
| 1.2 | Activo No Corriente | Group only |
| 1.2.1 | Bienes de Uso | Inmuebles; Rodados; Muebles y Útiles; Instalaciones; Equipos de Computación; corresponding Depreciación Acumulada account for each |
| 2 | Pasivo | Group only |
| 2.1 | Pasivo Corriente | Group only |
| 2.1.1 | Deudas Comerciales | Proveedores; Acreedores Varios; Cheques de Pago Diferido Entregados |
| 2.1.2 | Préstamos | Adelantos en Cuenta Corriente; Préstamos Bancarios a pagar |
| 2.1.3 | Remuneraciones y Cargas Sociales | Sueldos a Pagar; Cargas Sociales a Pagar (AFIP, Sindicatos, Obra Social); Provisión para SAC y Vacaciones |
| 2.1.4 | Cargas Fiscales | IVA Débito Fiscal; IVA Saldo a Pagar; Ingresos Brutos a Pagar; Provisión Impuesto a las Ganancias; Moratorias AFIP |
| 2.2 | Pasivo No Corriente | Group only |
| 2.2.1 | Deudas a Largo Plazo | Préstamos Bancarios (cuotas con vencimiento a más de un año) |
| 3 | Patrimonio Neto | Group only |
| 3.1 | Capital | Capital Social; Aportes Irrevocables |
| 3.2 | Resultados Acumulados | Reserva Legal; Resultados No Asignados; Resultado del Ejercicio |
| 4 | Ingresos | Group only |
| 4.1 | Ingresos Operativos | Ventas de Mercaderías; Ventas de Servicios; Cuotas sociales |
| 4.2 | Otros Ingresos | Intereses Ganados; Diferencias de Cambio (positivas); Descuentos Obtenidos |
| 5 | Egresos | Group only |
| 5.1 | Costos Operativos | Costo de Mercaderías Vendidas (CMV) |
| 5.2 | Gastos de Administración y Comercialización | Sueldos y Jornales; Cargas Sociales; Alquileres Perdidos; Servicios (Luz, Agua, Internet); Honorarios Profesionales; Seguros; Movilidad y Viáticos; Papelería y Útiles; Impuestos y Tasas (Municipales/Provinciales) |
| 5.3 | Gastos Financieros | Intereses Perdidos; Gastos y Comisiones Bancarias; Diferencias de Cambio (negativas); Impuesto a los Débitos y Créditos Bancarios (Ley 25.413) |
| 5.4 | Depreciaciones | Amortización / Depreciación Bienes de Uso |

## Explicit project override
The user's later clarification defines Valores a Depositar as the destination of the server-computed positive CASH close outflow, not merely third-party cheques. It is a logical closing transfer, not a bank-deposit confirmation or a second physical-handoff declaration. Account-linked movements are accounting source records; full double-entry ledger, depreciation calculations, fiscal computation and foreign-currency settlement are not implied by including account names.

## Confirmed production binding
`Cuotas sociales` is an approved imputable leaf under `4.1 Ingresos Operativos`. Dues production binds to that leaf. This does not classify any other production origin: each other origin needs its own explicit approved account binding and MUST NOT silently use `Cuotas sociales` or `Ventas de Servicios`.

## Remaining design detail, not missing user input
Assign deterministic leaf suffixes (example 1.1.1.01) without changing user groups; distinguish grouped tax/utility labels into proposed children if useful. The approved dues binding does not authorize silent bindings for other production origins.
