-- ============================================================================
--  GUARD DE INMUTABILIDAD DE FACTURAS (RF.13) — a nivel de BASE DE DATOS
-- ============================================================================
-- Una Invoice en status = 'ISSUED' es INMUTABLE: no puede modificarse ni
-- borrarse. La única transición permitida es el latch DRAFT → ISSUED (un UPDATE
-- cuyo estado PREVIO es DRAFT/FAILED). Este guard vive en la BD, no solo en la
-- capa de servicio: aunque un bug, un script o un acceso directo intenten alterar
-- una factura ya emitida, Postgres lo rechaza. Es el equivalente fiscal (con
-- consecuencias legales) al invariante bumpBalance == SUM(ledger).
--
-- NOTA: los triggers son BEFORE UPDATE/DELETE a nivel de FILA. TRUNCATE NO los
-- dispara, por lo que la limpieza de las suites de test (TRUNCATE ... CASCADE)
-- sigue funcionando aun con facturas ISSUED presentes.

-- ── Invoice: bloquea UPDATE y DELETE cuando el estado PREVIO ya es ISSUED ──────
CREATE OR REPLACE FUNCTION invoice_immutable_when_issued()
RETURNS trigger AS $$
BEGIN
  IF OLD.status = 'ISSUED' THEN
    RAISE EXCEPTION
      'Invoice % is ISSUED and is immutable: it cannot be updated or deleted (correct it with a rectificative invoice instead)',
      OLD.id
      USING ERRCODE = 'check_violation';
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER invoice_immutable_guard
  BEFORE UPDATE OR DELETE ON "Invoice"
  FOR EACH ROW
  EXECUTE FUNCTION invoice_immutable_when_issued();

-- ── InvoiceLine: inmutable si su Invoice padre está ISSUED ────────────────────
-- No se pueden añadir, quitar ni modificar líneas de una factura ya emitida. Las
-- líneas se crean mientras la factura está DRAFT; tras el latch a ISSUED quedan
-- congeladas. (Un padre inexistente/borrándose → v_status NULL → permitido, para
-- no interferir con el DELETE en cascada de facturas DRAFT.)
CREATE OR REPLACE FUNCTION invoice_line_immutable_when_issued()
RETURNS trigger AS $$
DECLARE
  v_status "InvoiceStatus";
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT status INTO v_status FROM "Invoice" WHERE id = NEW."invoiceId";
    IF v_status = 'ISSUED' THEN
      RAISE EXCEPTION 'Cannot add a line to ISSUED Invoice %', NEW."invoiceId"
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;

  ELSIF TG_OP = 'UPDATE' THEN
    SELECT status INTO v_status FROM "Invoice" WHERE id = OLD."invoiceId";
    IF v_status = 'ISSUED' THEN
      RAISE EXCEPTION 'Cannot modify a line of ISSUED Invoice %', OLD."invoiceId"
        USING ERRCODE = 'check_violation';
    END IF;
    SELECT status INTO v_status FROM "Invoice" WHERE id = NEW."invoiceId";
    IF v_status = 'ISSUED' THEN
      RAISE EXCEPTION 'Cannot move a line into ISSUED Invoice %', NEW."invoiceId"
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;

  ELSE -- DELETE
    SELECT status INTO v_status FROM "Invoice" WHERE id = OLD."invoiceId";
    IF v_status = 'ISSUED' THEN
      RAISE EXCEPTION 'Cannot delete a line of ISSUED Invoice %', OLD."invoiceId"
        USING ERRCODE = 'check_violation';
    END IF;
    RETURN OLD;
  END IF;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER invoice_line_immutable_guard
  BEFORE INSERT OR UPDATE OR DELETE ON "InvoiceLine"
  FOR EACH ROW
  EXECUTE FUNCTION invoice_line_immutable_when_issued();
