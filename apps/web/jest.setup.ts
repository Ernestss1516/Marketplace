import '@testing-library/jest-dom';

// UXV.5 — jsdom no implementa `scrollIntoView` (no tiene layout, así que no hay a dónde
// hacer scroll). El editor de secciones la usa para llevar al usuario a la primera sección
// con errores, y sin este stub cualquier prueba que valide revienta con un TypeError que
// no dice nada del fallo real. Es una carencia del ENTORNO, no del componente: por eso se
// rellena aquí y no se ensucia el código con un `?.` defensivo.
if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = function scrollIntoView() {};
}
