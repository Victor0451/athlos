import { GORRITI_LOGO_BASE64 } from './logo.ts'
import { SOLICITUD_INSCRIPCION_STYLES } from './solicitud-inscripcion.styles.ts'

/**
 * HTML template for the `solicitud-inscripcion` PDF.
 *
 * Single TS string constant with `{{var}}` placeholders that
 * `renderTemplate()` substitutes at request time. The shape mirrors
 * the source `/srv/docs/ficha.docx` (club header, titular block,
 * domicilio block, FESCAG regulation at the end). Auto-filled
 * placeholders:
 *
 *   {{logo_base64}}   — data-URI PNG (baked into the source constant)
 *   {{styles}}        — CSS block (baked into the styles constant)
 *   {{titular_nombre}}— `apellido + ', ' + nombre`
 *   {{dni}}           — titular DNI
 *   {{fecha_nacimiento}} — formatted DD/MM/YYYY or blank
 *   {{numero_socio}}  — printed in the `.rect-socio` floating rectangle
 *   {{domicilio_calle}}, {{domicilio_numero}}, {{domicilio_barrio}}
 *   {{domicilio_telefono}}
 *   {{email}}
 *   {{fecha_emision}} — server `today` formatted DD/MM/YYYY (FESCAG)
 *
 * ACTA Nº, DOMICILIO LABORALES, GRUPO FAMILIAR, CADETE, PADRE/MADRE,
 * SOCIO PRESENTANTE × 2, signature lines and the header date are
 * intentionally left blank — operators complete them by hand on the
 * printed form.
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
    <img class="club-logo" src="{{logo_base64}}" alt="Club Atletico Gorriti">
    <p class="club-name">CLUB ATLETICO GORRITI</p>
    <p class="club-data">ENTIDAD SIN FINES DE LUCRO FUNDADA EL 10 DE NOVIEMBRE DE 1937 &mdash; PERSONERIA JURIDICA DECRETO N&ordm; 1574-G-1943</p>
  </header>

  <main>
    <p class="header-date">SAN SALVADOR DE JUJUY, ....... DE ....................... DE ..........</p>

    <div class="numero-fields">
      <div class="field-block">
        <span class="field-label">SOCIO N&ordm;:</span>
        <span class="dotted-line">{{numero_socio}}</span>
      </div>
      <div class="field-block">
        <span class="field-label">ACTA N&ordm;:</span>
        <span class="dotted-line">&nbsp;</span>
      </div>
    </div>

    <p class="intro">A LOS SRES. DE LA N&ordm; COMISION DIRECTIVA DEL CLUB ATLETICO GORRITI</p>

    <p class="intro">SU / DESPACHO EL / LA que suscribe <span class="dotted-line">{{titular_nombre}}</span> tiene el agrado de dirigirse a Uds. con el motivo de solicitar SU INSCRIPCION como SOCIO, declarando conocer los estatutos de esta entidad, sus derechos y obligaciones.</p>

    <p class="identificacion">D.N.I. N&ordm; <span class="dotted-line">{{dni}}</span> &nbsp;&nbsp; FECHA DE NACIMIENTO <span class="dotted-line">{{fecha_nacimiento}}</span></p>

    <p class="declaracion">Declaro mi domicilio legal y actual, el lugar de cobro de cuotas sociales, cuotas escuelas y toda otra obligacion que surgiere en su asociacion a esta entidad.</p>

    <p class="declaracion">Declaro que debo comunicar en forma escrita mi baja como SOCIO y debo tener mis obligaciones abonadas al mes correspondiente a dicho pedido (las cuotas son obligatorias y se abonan hasta el momento de la renuncia). Los pagos se realizan del uno (01) al diez (10) de cada mes.</p>

    <p class="declaracion">Los datos figurantes mas abajo son los reales a la fecha de la presentacion de la presente solicitud comprometiendome a notificar de cualquier cambio.</p>

    <div class="domicilio-block">
      <div class="domicilio-line">
        <span class="label">CALLE:</span>
        <span class="dotted-line">{{domicilio_calle}}</span>
        <span class="label">N&ordm;:</span>
        <span class="dotted-line">&nbsp;</span>
        <span class="label">BARRIO:</span>
        <span class="dotted-line">&nbsp;</span>
      </div>
      <div class="domicilio-line">
        <span class="label">TELEF:</span>
        <span class="dotted-line">{{domicilio_telefono}}</span>
      </div>
    </div>

    <div class="otros-block">
      <div class="otros-line">CORREO ELECTRONICO DEL TITULAR: <span class="dotted-line">{{email}}</span></div>
    </div>

    <p style="margin-top:8mm; font-size:10pt; text-align:center;">FONDO DE EMERGENCIA SOLIDARIO CLUB ATLETICO GORRITI</p>
    <p style="font-size:10pt; font-weight:bold; text-align:center; margin:2mm 0;">REGLAMENTO DE FUNCIONAMIENTO</p>

    <div class="fescag-section">
      <h2>FESCAG &mdash; REGLAMENTO</h2>
      <p>Con el fin de mejorar y ampliar la cobertura medica asistencial primaria y basica ante lesiones que pudiesen ocurrir durante las actividades deportivas que realicen los SOCIOS y JUGADORES de la INSTITUCION dentro del ambito de nuestro predio y en competencias donde representen al CLUB ATLETICO GORRITI en forma oficial y/o que tenga la autorizacion de la C.D., siendo los deportes vigentes a la fecha: FUTBOL, BASQUETBOL, VOLEIBOL, HANDBALL Y HOCKEY SOBRE CESPED, GIMNASIA ARTISTICA, TAEKWON-DO, se resuelve reformar el REGLAMENTO DEL FESCAG (Seguro de Emergencia Medica del Club Atletico Gorriti) quedando el mismo de la siguiente manera:</p>

      <div class="article"><strong>ART. N&ordm; 1</strong> El pago del presente SEGURO DE EMERGENCIA MEDICA DEL CLUB ATLETICO GORRITI se establece con caracter OBLIGATORIO para todos los SOCIOS y JUGADORES que realizan actividades deportivas, tanto del predio de la institucion como fuera de ella, en entrenamiento y encuentros representando oficialmente a la entidad, debiendo tener AUTORIZACION de la C.D. NO PUDIENDO REPRESENTAR A LA INSTITUCION AQUELLOS QUE NO ESTEN ABONANDO EL PRESENTE SEGURO.</div>

      <div class="article"><strong>ART. N&ordm; 2</strong> El personal medico que atendera las lesiones que ocurriesen sera previsto por contrato, del cual se destacan: a) Declarar Area Protegida con servicio de emergencia inclusive a todo el predio del club y a lugares donde desarrollen actividades deportivas jugadores que representen al mismo y que tengan la debida autorizacion de la C.D. b) Establecer un seguro nominativo por muerte o incapacidad total y parcial en caso de accidente. c) En caso de derivacion y practica medica, asistencia medica y farmaceutica hasta la suma de pesos un mil quinientos ($ 1.500) por evento.</div>

      <div class="article"><strong>ART. N&ordm; 3</strong> El pago del FESCAG se realizara en SECRETARIA de la institucion, en el monto vigente a partir del 01/01/26 ($ 8.500,00) mensuales tomando la modalidad de pagos mensuales para el ordenamiento de altas y bajas del seguro nominativo. Para nuevas altas y periodo de prueba se debera abonar el monto mensual correspondiente hasta el inicio del proximo bimestre.</div>

      <div class="article"><strong>ART. N&ordm; 4</strong> En caso de existencia de lesiones en entrenamiento o partidos, deberan ser informados en SECRETARIA por los instructores a cargo de esa actividad, debiendo ser asentados en el cuaderno correspondiente.</div>
    </div>

    <p style="margin-top:6mm; text-align:center;">San Salvador de Jujuy, {{fecha_emision}}</p>

    <div class="signature-line">
      <div class="sig">FIRMA SOLICITANTE</div>
      <div class="sig">FIRMA PADRE / MADRE</div>
    </div>
  </main>

  <div class="rect-socio"></div>
  <div class="rect-acta"></div>
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
  domicilioTelefono: string
  email: string
  fechaEmision: string
}

export function buildSolicitudVariables(input: SolicitudVariables): Record<string, string> {
  return {
    styles: input.styles,
    logo_base64: input.logoBase64,
    titular_nombre: input.titularNombre,
    dni: input.dni,
    fecha_nacimiento: input.fechaNacimiento,
    numero_socio: input.numeroSocio,
    domicilio_calle: input.domicilioCalle,
    domicilio_telefono: input.domicilioTelefono,
    email: input.email,
    fecha_emision: input.fechaEmision,
  }
}

export const SOLICITUD_INSCRIPCION_DEFAULTS = {
  styles: SOLICITUD_INSCRIPCION_STYLES,
  logoBase64: GORRITI_LOGO_BASE64,
} as const
