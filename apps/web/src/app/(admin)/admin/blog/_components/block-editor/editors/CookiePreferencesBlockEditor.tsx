// COOKIES RÁFAGA 3 — sin campos, y el texto explica POR QUÉ no los hay.
//
// La tentación al ver un bloque sin opciones es pensar que faltan. Aquí no faltan: lo que
// el panel enseña —las dos categorías que corresponden a cookies reales y el estado del
// visitante— es la mecánica del consentimiento, que es legal y fija. Un editor capaz de
// añadir una categoría «marketing» estaría describiendo un tratamiento inexistente en el
// documento que existe precisamente para no mentir.
export function CookiePreferencesBlockEditor() {
  return (
    <p className="text-xs italic text-muted-foreground">
      Sin opciones — muestra las categorías reales y el estado de quien lee, y deja cambiar
      o retirar el consentimiento. Lo que enseña no se configura: es la mecánica del
      consentimiento. Colócalo donde quieras dentro de la política de cookies.
    </p>
  );
}
