import { GORRITI_LOGO_BASE64 } from './logo.ts'
import { SOLICITUD_INSCRIPCION_STYLES } from './solicitud-inscripcion.styles.ts'

/**
 * HTML template for the `solicitud-inscripcion` PDF.
 *
 * **2026-07-09 chore (papurri):** full rewrite from the source `ficha.docx`
 * to match the layout in `/srv/docs/transcripcion_gorriti.md` (operator's
 * reference transcription). The new layout is the canonical one; the
 * previous version used free-flow divs which collapsed the visual
 * structure.
 *
 * Structure (top-to-bottom):
 *   - Header (logo + club data)
 *   - Date line + 2 floating textboxes (SOCIO Nº, ACTA Nº) anchored
 *     top-right
 *   - Section 1 — Solicitud de Inscripción
 *       - Recipient line (A LOS SRES. DE LA … COMISIÓN DIRECTIVA DEL
 *         CLUB ATLÉTICO GORRITI)
 *       - "SU / DESPACHO" heading
 *       - Body paragraph (quien suscribe + DNI + fecha nac)
 *       - 4 long declaracion paragraphs
 *       - Table T1 — Datos del solicitante (5 cols × 8 rows, with
 *         merged cells in column 0 for the row labels)
 *       - Table T2 — Grupo Familiar (5 cols × 10 rows, with header
 *         row in grey)
 *       - Padre/madre authorization paragraph
 *       - 4-column signature line (solicitante / padre-madre / socio
 *         presentante 1 / socio presentante 2)
 *   - Section 2 — FESCAG Reglamento
 *       - 2 centered headings (FONDO DE EMERGENCIA + REGLAMENTO)
 *       - Preámbulo paragraph
 *       - 10 artículos
 *       - Acceptance block (line + DNI line)
 *       - Signature line (Firma y Aclaración del solicitante + DNI)
 *   - Section 3 — Acta de Conformidad
 *       - Centered heading
 *       - Acceptance paragraph
 *       - 2-line signature (Firma + Aclaración)
 *   - Section 4 — Ficha del Jugador
 *       - Centered heading + DEPORTE line
 *       - Table T3 — Apellido / Nombre (2 cols × 2 rows)
 *       - Datos personales lines (FECHA NAC, DNI, NACIONALIDAD,
 *         DOMICILIO, TELÉFONO)
 *       - Table T4 — Emails (1 col × 2 rows)
 *       - Historial clínico block (multiple lines for medical history)
 *       - Datos del padre block
 *       - Datos de la madre block
 *       - Comentarios y autorización block
 *       - 2-line signature (FIRMA DEL PADRE / FIRMA DE LA MADRE) +
 *         DNI line
 *
 * Auto-filled placeholders (camelCase; the `buildSolicitudVariables`
 * helper passes the matching key):
 *
 *   {{logoBase64}}      — data-URI PNG (baked into the source constant)
 *   {{styles}}          — CSS block (baked into the styles constant)
 *   {{titularNombre}}   — `apellido + ', ' + nombre`
 *   {{dni}}             — titular DNI
 *   {{fechaNacimiento}} — formatted DD/MM/YYYY or blank
 *   {{numeroSocio}}     — printed in the SOCIO Nº floating textbox
 *   {{domicilioCalle}}, {{domicilioNumero}}, {{domicilioBarrio}}
 *   {{domicilioTelefono}}
 *   {{email}}
 *   {{fechaEmision}}    — server `today` formatted DD/MM/YYYY
 *
 * ACTA Nº, GRUPOS FAMILIARES rows, all medical / laboral / familiar
 * fields, signatures, and dates are intentionally left blank for the
 * operator to complete by hand on the printed form.
 */
export const SOLICITUD_INSCRIPCION_TEMPLATE = `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <title>Solicitud de Inscripcion - Club Atletico Gorriti</title>
  <style>{{styles}}</style>
</head>
<body>

  <header class="club-header">
    <img class="club-logo" src="{{logoBase64}}" alt="Club Atletico Gorriti">
    <p class="club-name">CLUB ATLETICO GORRITI</p>
    <p class="club-data">ENTIDAD SIN FINES DE LUCRO FUNDADA EL 10 DE NOVIEMBRE DE 1937 &mdash; PERSONERIA JURIDICA DECRETO N&ordm; 1574-G-1943</p>
  </header>

  <main>
    <p class="header-date">SAN SALVADOR DE JUJUY, ....... DE ....................... DE ..........</p>

    <div class="textboxes-row">
      <div class="floating-numero">SOCIO N&ordm;: <span class="dotted">{{numeroSocio}}</span></div>
      <div class="floating-acta">ACTA N&ordm;: <span class="dotted">&nbsp;</span></div>
    </div>

    <p class="destinatario">A LOS SRES. DE LA N&ordm; COMISION DIRECTIVA DEL <strong>CLUB ATL&Eacute;TICO GORRITI</strong></p>

    <h2 class="subheading">SU &nbsp;&nbsp; / &nbsp;&nbsp; DESPACHO</h2>

    <p class="intro">EL / LA que suscribe <span class="dotted">{{titularNombre}}</span> tiene el agrado de dirigirse a Uds. con el motivo de solicitar <strong>SU INSCRIPCI&Oacute;N como SOCIO</strong>: <span class="dotted">&nbsp;</span> Declarando conocer los estatutos de esta entidad, sus derechos y obligaciones.</p>

    <p class="identificacion">D.N.I. N&ordm; <span class="dotted">{{dni}}</span> &nbsp;&nbsp; FECHA DE NACIMIENTO <span class="dotted">{{fechaNacimiento}}</span></p>

    <p class="declaracion">Declaro mi domicilio legal y actual, el lugar de cobro de cuotas sociales, cuotas escuelas y toda otra obligacion que surgiere en su asociacion a esta entidad.</p>

    <p class="declaracion">Declaro que debo comunicar en forma escrita mi baja como SOCIO y debo tener mis obligaciones abonadas al mes correspondiente a dicho pedido (las cuotas son obligatorias y se abonan hasta el momento de la renuncia). Los pagos se realizan del uno (01) al diez (10) de cada mes.</p>

    <p class="declaracion">Los datos figurantes mas abajo son los reales a la fecha de la presentacion de la presente solicitud comprometiendome a notificar de cualquier cambio.</p>

    <table class="tabla-t1">
      <tr>
        <td class="label-cell" rowspan="2"><strong>DOMICILIO<br>PARTICULAR</strong></td>
        <td class="label-cell">CALLE:</td>
        <td class="dotted-cell"><span class="dotted">{{domicilioCalle}}</span></td>
        <td class="label-cell">N&ordm;:</td>
        <td class="dotted-cell"><span class="dotted">{{domicilioNumero}}</span></td>
        <td class="label-cell">BARRIO:</td>
        <td class="dotted-cell"><span class="dotted">{{domicilioBarrio}}</span></td>
        <td class="label-cell">TELEF:</td>
        <td class="dotted-cell"><span class="dotted">{{domicilioTelefono}}</span></td>
      </tr>
      <tr>
        <td class="label-cell" colspan="2"><strong>DOMICILIO LABORALES</strong></td>
        <td class="label-cell">CALLE::</td>
        <td class="dotted-cell"><span class="dotted">&nbsp;</span></td>
        <td class="label-cell">N&ordm;</td>
        <td class="dotted-cell"><span class="dotted">&nbsp;</span></td>
        <td class="label-cell">BARRIO</td>
        <td class="dotted-cell"><span class="dotted">&nbsp;</span></td>
        <td class="label-cell">TELEF.:</td>
        <td class="dotted-cell"><span class="dotted">&nbsp;</span></td>
      </tr>
      <tr>
        <td class="label-cell" rowspan="2"><strong>OTROS</strong></td>
        <td class="label-cell">EMP. PUBLICO</td>
        <td class="dotted-cell checkbox-cell">[ &nbsp; ]</td>
        <td class="label-cell">EMP. PRIVADO</td>
        <td class="dotted-cell checkbox-cell">[ &nbsp; ]</td>
        <td class="label-cell">PROFESIONAL</td>
        <td class="dotted-cell checkbox-cell" colspan="3">[ &nbsp; ] INDEPEN.</td>
      </tr>
      <tr>
        <td class="label-cell" colspan="8"><strong>CORREO ELECTRONICO DEL TITULAR</strong>: <span class="dotted">{{email}}</span></td>
      </tr>
    </table>

    <h3 class="caption">GRUPO FAMILIAR</h3>

    <table class="tabla-t2">
      <thead>
        <tr>
          <th>APELLIDO Y NOMBRES</th>
          <th>PARENTESCO</th>
          <th>FECHA NAC</th>
          <th>N&ordm; D.N.I</th>
          <th>DEPORTE</th>
        </tr>
      </thead>
      <tbody>
        <tr><td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td></tr>
        <tr><td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td></tr>
        <tr><td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td></tr>
        <tr><td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td></tr>
        <tr><td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td></tr>
        <tr><td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td></tr>
        <tr><td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td></tr>
        <tr><td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td></tr>
        <tr><td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td><td>&nbsp;</td></tr>
      </tbody>
    </table>

    <p class="autorizacion">YO PADRE / MADRE <span class="dotted">&nbsp;</span> D.N.I. N&ordm; <span class="dotted">&nbsp;</span> AUTORIZO A M&Iacute;</p>
    <p class="autorizacion">HIJO/A <span class="dotted">&nbsp;</span> DNI N&ordm;: <span class="dotted">&nbsp;</span> A INSCRIBIRSE COMO</p>
    <p class="autorizacion">SOCIO CADETE ASUMIENDO EL COMPROMISO DEL PAGO DE LAS OBLIGACIONES EMERGENTES.</p>

    <div class="signature-grid">
      <div class="sig-col">
        <div class="sig-line">&nbsp;</div>
        <div class="sig-label">FIRMA SOLICITANTE</div>
      </div>
      <div class="sig-col">
        <div class="sig-line">&nbsp;</div>
        <div class="sig-label">FIRMA PADRE/ MADRE</div>
      </div>
      <div class="sig-col">
        <div class="sig-line">&nbsp;</div>
        <div class="sig-label">SOCIO PRESENTANTE</div>
        <div class="sig-num">N&ordm;: <span class="dotted-small">&nbsp;</span></div>
      </div>
      <div class="sig-col">
        <div class="sig-line">&nbsp;</div>
        <div class="sig-label">SOCIO PRESENTANTE</div>
        <div class="sig-num">N&ordm;: <span class="dotted-small">&nbsp;</span></div>
      </div>
    </div>
  </main>

  <section class="fescag-section">
    <h2 class="section-title">FONDO DE EMERGENCIA SOLIDARIO CLUB ATL&Eacute;TICO GORRITI</h2>
    <h3 class="section-subtitle">REGLAMENTO DE FUNCIONAMIENTO</h3>

    <p>Con el fin de mejorar y ampliar la cobertura medica asistencial primaria y basica ante lesiones que pudiesen ocurrir durante las actividades deportivas que realicen los SOCIOS y JUGADORES de la INSTITUCION dentro del &aacute;mbito de nuestro predio y en competencias donde representen al CLUB ATLETICO GORRITI en forma oficial y / o que tenga la autorizacion de la C. D. siendo los deportes vigentes a la fecha: <strong>F&Uacute;TBOL, B&Aacute;SQUETBOL, VOLEIBOL, HANDBALL Y HOCKEY SOBRE C&Eacute;SPED. GIMNASIA ART&Iacute;STICA. TAEKWON-DO.</strong>, se resuelve reformar el REGLAMENTO DEL FESCAG (Seguro de Emergencia Medica del Club Atletico Gorriti) quedando el mismo de la siguiente manera:</p>

    <div class="article"><strong>ART. N&ordm; 1</strong> El pago del presente SEGURO DE EMEMERGENCIA MEDICA DEL CLUB ATLETICO GORRITI se establece con car&aacute;cter <strong>OBLIGATORIO</strong> para todos los SOCIOS y JUGADORES que realizan actividades deportivas, tanto del predio de la institucion como fuera de ella, en entrenamiento y encuentros representando oficialmente a la entidad debiendo tener AUTORIZACI&Oacute;N de la C. D. NO PUDIENDO REPRESENTAR A LA INSTITUCI&Oacute;N AQUELLOS QUE NO ESTEN ABONANDO EL PRESENTE SEGURO<span class="dotted">&nbsp;</span></div>

    <div class="article"><strong>ART. N&ordm; 2:</strong> El personal m&eacute;dico que atender&aacute; las lesiones que ocurriesen ser&aacute; previsto por contrato con <span class="dotted">&nbsp;</span> del cual se destacan:
      <div class="subitem">a) Declarar &Aacute;rea Protegida con servicio de emergencia inclusive a todo el predio del club y a lugares donde desarrollen actividades deportivas jugadores que representen al mismo y que tengan la debida autorizacion de la C. D.</div>
      <div class="subitem">b) Establecer un seguro nominativo por muerte o incapacidad total y parcial en caso de accidente (suma asegurada de pesos quince mil <strong>$ 15.000</strong>).</div>
      <div class="subitem">c) En caso de derivaci&oacute;n y pr&aacute;ctica m&eacute;dica, asistencia m&eacute;dica y farmac&eacute;utica hasta la suma de pesos un mil quinientos (<strong>$ 1.500</strong>) por evento <span class="dotted">&nbsp;</span></div>
    </div>

    <div class="article"><strong>ART. N&ordm; 3:</strong> El pago del FESCAG se realizara en SECRETARIA de la instituci&oacute;n, el monto vigente a partir del 01/01/26 mil <strong>$8500.00</strong>) mensuales tomando la modalidad de pagos mensuales para el ordenamiento de altas y bajas del seguro nominativo. Para nuevas altas y periodo de prueba se deber&aacute; abonar el monto mensual correspondiente hasta el inicio del pr&oacute;ximo bimestre.</div>

    <div class="article"><strong>ART. N&ordm; 4:</strong> En caso de existencia de lesiones en entrenamiento o partidos. Deber&aacute;n ser informados en SECRETARIA por los instructores a cargo de esa actividad, debiendo ser asentados en el cuaderno dispuesto para ese tr&aacute;mite debiendo consignar fecha, hora, lugar y circunstancias, si hubo pedido de ambulancia y quien acompa&ntilde;o al afectado debiendo firmar dicho informe. En caso de no denunciar dicha lesi&oacute;n <strong>NO SE RECONOCER&Aacute;</strong> ninguna atenci&oacute;n a posterior, recayendo dicha responsabilidad en los instructores.</div>

    <div class="article"><strong>ART. N&ordm; 5:</strong> Cuando un jugador se presenta lesionado al entrenamiento o partido el instructor DEBERA informar en SECRETARIA de dicha circunstancia ya que si la lesi&oacute;n no fue informada con anterioridad no se reconocer&aacute; atenci&oacute;n bajo ninguna circunstancia<span class="dotted">&nbsp;</span></div>

    <div class="article"><strong>ART. N&ordm; 6:</strong> Se establece la <strong>OBLIGACI&Oacute;N DE PRESENTAR CON CAR&Aacute;CTER DE DECLARACI&Oacute;N JURADA</strong> una ficha que ser&aacute; entregada en SECRETARIA al inscribirse por primera vez debiendo ser entregado en 48 hs. de recibida y el <strong>FONDO SOLIDARIO COMENZAR&Aacute; A REGIR A PARTIR DEL SEGUNDO MES DE PAGO QUE SE CUENTA DESDE LA RECEPCI&Oacute;N DE DICHA FICHA</strong>. CONJUNTAMENTE CON LA FICHA DEBERA PRESENTAR EL CERTIFICADO MEDICO DONDE CONSTE QUE EL / LA JUGADOR /A O SOCIO /SOCIA Y / O FAMILIAR DECLARADO ESTA EN CONDICIONES DE SALUD PARA REALIZAR ACTIVIDADES F&Iacute;SICAS Y DEPORTIVAS. En caso de jugadores que ya pertenecen a la entidad ser&aacute; previsto a trav&eacute;s de los respectivos instructores debiendo ser entregada en secretaria dentro de las 48 hs. de haberla recibido.</div>

    <div class="article"><strong>ART. N&ordm; 7:</strong> Los jugadores y socios deber&aacute;n informar si poseen OBRA SOCIAL y sus caracter&iacute;sticas para que en el caso de lesiones de los mismos el FESCAG reconozca el costo del coaseguro respectivo contra presentaci&oacute;n de los comprobantes respectivos o en caso de nuestra atenci&oacute;n inmediatamente<span class="dotted">&nbsp;</span></div>

    <div class="article"><strong>ART. N&ordm; 8:</strong> Los casos no contemplados en el presente reglamento ser&aacute;n resueltos por Comisi&oacute;n Directiva.</div>

    <div class="article"><strong>ART. N&ordm; 9:</strong> En caso de reincorporarse el DEPORTE RUGBY, se reglamentar&aacute; el costo del fondo solidario para la actividad debido al alto riesgo de lesiones del mismo.</div>

    <div class="article"><strong>ART. N&ordm; 10:</strong> El presente reglamento FESCAG ser&aacute; entregado a cada uno de los deportistas y socios, se exhibir&aacute; en la cartelera ubicada en secretaria y se notificar&aacute; a los Sres. Instructores y personal de la instituci&oacute;n de la obligaci&oacute;n a cumplimentar.</div>

    <p>El / La que suscribe <span class="dotted">{{titularNombre}}</span> DNI N&ordm; <span class="dotted">{{dni}}</span> toma</p>
    <p>Conocimiento de lo trascripto m&aacute;s arriba y <strong>ACEPTO LOS TERMINOS VERTIDOS EN DICHO REGLAMENTO SIN RECLAMOS FUTUROS ALGUNOS</strong>.</p>

    <p style="text-align:center; margin-top:6mm;">______________________________</p>

    <div class="signature-grid signature-grid-2">
      <div class="sig-col">
        <div class="sig-label">Firma y Aclaraci&oacute;n del solicitante</div>
      </div>
    </div>
    <div class="signature-grid signature-grid-2">
      <div class="sig-col">
        <div class="sig-label">DNI N&deg; <span class="dotted">&nbsp;</span></div>
      </div>
    </div>

    <p style="text-align:center;">San Salvador de Jujuy, <span class="dotted">&nbsp;</span>de <span class="dotted">&nbsp;</span>2026</p>
  </section>

  <section class="acta-section">
    <h2 class="section-title">ACTA DE CONFORMIDAD</h2>
    <p>Por la presente se deja constancia que el Se&ntilde;or / a <span class="dotted">&nbsp;</span> DNI <span class="dotted">&nbsp;</span> conoce y acepta de total conformidad la reglamentaci&oacute;n interna del CLUB, sus Estatutos y el Reglamento de Funcionamiento del convenio de Asistencia de Emergencia los mismos que rigen para Socios e hijos de socios en las disciplinas deportivas que los mismos practican en representaci&oacute;n del Club Atl&eacute;tico Gorriti.</p>

    <div class="signature-grid signature-grid-2">
      <div class="sig-col">
        <div class="sig-label">Firma <span class="dotted">&nbsp;</span></div>
      </div>
      <div class="sig-col">
        <div class="sig-label">Aclaraci&oacute;n <span class="dotted">&nbsp;</span></div>
      </div>
    </div>
  </section>

  <section class="ficha-section">
    <h2 class="section-title">FICHA DEL JUGADOR / A <span class="dotted-small">&nbsp;</span> DEPORTE <span class="dotted">&nbsp;</span></h2>

    <table class="tabla-t3">
      <tr>
        <th>APELLIDO</th>
        <th>NOMBRE</th>
      </tr>
      <tr>
        <td class="empty-cell">&nbsp;</td>
        <td class="empty-cell">&nbsp;</td>
      </tr>
    </table>

    <p>FECHA DE NACIMIENTO ......... /……. /……. &nbsp;&nbsp; DNI N&ordm; ............................ &nbsp;&nbsp; NACIONALIDAD ........................</p>
    <p>DOMICILIO ............................................................................................ &nbsp;&nbsp; TEL&Eacute;FONO ..............................</p>

    <p>NOMBRE DE MEDICO DE CABECERA ...........................................................................</p>

    <p>MARCAR ENFERMEDADES QUE TUVO: RUBEOLA [ &nbsp; ] &nbsp; SARAMPI&Oacute;N [ &nbsp; ] &nbsp; PAPERAS [ &nbsp; ] &nbsp; VARICELA [ &nbsp; ] &nbsp; HEPATITIS / U [ &nbsp; ] &nbsp; OTRAS ENFERMEDADES ......................................................</p>
    <p>&iquest;TIENE TODAS LAS VACUNAS? ................................................................................</p>
    <p>INTERVENCIONES QUIR&Uacute;RGICAS ................................................................................</p>
    <p>REACCIONES AL&Eacute;RGICAS A ALG&Uacute;N MEDICAMENTO (SI LAS HAY A QUE) .............................</p>
    <p>TIENE PROBLEMAS: CARDIACOS *……… &nbsp;&nbsp; RESPIRATORIOS *……………… &nbsp;&nbsp; AUDITIVOS *…………….</p>
    <p>GRUPO SANGU&Iacute;NEO ............................. &nbsp;&nbsp; OBRA SOCIAL .................................................</p>

    <p>NOMBRE Y APELLIDO DEL PADRE ...........................................................................</p>
    <p>NACIONALIDAD ........................................................ &nbsp;&nbsp; PROFESI&Oacute;N ........................ &nbsp;&nbsp; ESTADO CIVIL ..........................</p>
    <p>LUGAR DONDE TRABAJA .................................. &nbsp;&nbsp; TEL&Eacute;FONO / CELULAR ........................</p>

    <p>NOMBRE Y APELLIDO DE LA MADRE .................................................................</p>
    <p>NACIONALIDAD ................................. &nbsp;&nbsp; PROFESI&Oacute;N ........................ &nbsp;&nbsp; ESTADO CIVIL ........................</p>
    <p>LUGAR DONDE TRABAJA .................................. &nbsp;&nbsp; TEL&Eacute;FONO / CELULAR ........................</p>

    <p>ALG&Uacute;N COMENTARIO DE INTER&Eacute;S ...........................................................................</p>

    <p><strong>POR LA PRESENTE AUTORIZO A NUESTRO HIJO / A PRACTICAR Y COMPETIR POR EL CLUB GORRITI COMO DEPORTISTA BAJO NUESTRA RESPONSABILIDAD.</strong></p>

    <div class="signature-grid signature-grid-2">
      <div class="sig-col">
        <div class="sig-label">FIRMA DEL PADRE</div>
      </div>
      <div class="sig-col">
        <div class="sig-label">FIRMA DE LA MADRE</div>
      </div>
    </div>
    <div class="signature-grid signature-grid-2">
      <div class="sig-col">
        <div class="sig-label">DNI N&ordm; .................................</div>
      </div>
      <div class="sig-col">
        <div class="sig-label">DNI N&ordm; .................................</div>
      </div>
    </div>
  </section>

  <p style="text-align:center; margin-top:6mm;">San Salvador de Jujuy, <span class="dotted">{{fechaEmision}}</span></p>

</body>
</html>
`

/**
 * Build the variable bag for `renderTemplate()` from a socio + the
 * server `today`. Centralises the placeholders so adding a new field
 * only touches this function (the template constant stays untouched).
 *
 * `fechaNacimiento` is the raw DB value (`YYYY-MM-DD` or null); the
 * service layer (`emit-form.ts`) formats it to `DD/MM/YYYY` or empty
 * before passing it here.
 */
export interface SolicitudVariables {
  styles: string
  logoBase64: string
  titularNombre: string
  dni: string
  fechaNacimiento: string
  numeroSocio: string
  domicilioCalle: string
  domicilioNumero: string
  domicilioBarrio: string
  domicilioTelefono: string
  email: string
  fechaEmision: string
}

export function buildSolicitudVariables(input: SolicitudVariables): Record<string, string> {
  return {
    styles: input.styles,
    logoBase64: input.logoBase64,
    titularNombre: input.titularNombre,
    dni: input.dni,
    fechaNacimiento: input.fechaNacimiento,
    numeroSocio: input.numeroSocio,
    domicilioCalle: input.domicilioCalle,
    domicilioNumero: input.domicilioNumero,
    domicilioBarrio: input.domicilioBarrio,
    domicilioTelefono: input.domicilioTelefono,
    email: input.email,
    fechaEmision: input.fechaEmision,
  }
}

export const SOLICITUD_INSCRIPCION_DEFAULTS = {
  styles: SOLICITUD_INSCRIPCION_STYLES,
  logoBase64: GORRITI_LOGO_BASE64,
} as const
