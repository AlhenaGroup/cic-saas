# Convivia API v1

API REST per integrazioni esterne (POS, sviluppatori, sistemi terzi).

**Base URL:** `https://cic-saas.vercel.app/api/v1`

## Autenticazione

Header obbligatorio in ogni richiesta:

```
Authorization: Bearer pk_live_xxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

Le chiavi si generano da **Impostazioni → API Keys** sulla dashboard. La chiave si vede UNA volta sola al momento della generazione (in DB salviamo solo l'hash sha256).

## Convenzione richieste

Tutti gli endpoint sono sotto `/api/v1` e si distinguono per query param `resource` + `action`:

```
GET  /api/v1?resource=customers&action=list
POST /api/v1?resource=customers&action=create
POST /api/v1?resource=sales&action=create
GET  /api/v1?resource=loyalty&action=balance&customer_id=xxx
GET  /api/v1?resource=promotions
```

Body POST: JSON. Risposta: JSON.

## Errori

| HTTP | Significato |
|------|-------------|
| 200/201 | OK |
| 400 | Body mancante / parametri invalidi |
| 401 | Chiave non valida o revocata |
| 403 | Scope insufficienti |
| 404 | Risorsa non trovata |
| 500 | Errore server |

---

## Customers (CRM)

### `GET resource=customers&action=list`
Scope: `customers.read`

Query params:
- `limit` (1-200, default 50)
- `search` (cerca su nome/cognome/email/telefono)
- `telefono` (lookup esatto, utile alla cassa)
- `email` (lookup esatto)

Esempio uso POS: cliente entra e digiti il telefono per riconoscerlo.
```http
GET /api/v1?resource=customers&action=list&telefono=3331234567
```

### `GET resource=customers&action=get&id={uuid}`
Scope: `customers.read`

### `POST resource=customers&action=create`
Scope: `customers.write`

```json
{
  "nome": "Mario", "cognome": "Rossi",
  "telefono": "3331234567", "email": "mario@example.com",
  "data_nascita": "1990-05-12",
  "consenso_marketing": true,
  "note": "Cliente abituale"
}
```

### `POST resource=customers&action=update&id={uuid}`
Scope: `customers.write`

Body parziale: solo i campi da aggiornare.

---

## Sales (scontrini POS → daily_stats)

### `POST resource=sales&action=create`
Scope: `sales.write`

Sostituisce il sync CiC. Il POS chiama questo endpoint ad ogni chiusura comanda.

```json
{
  "id": "S0043",
  "locale": "REMEMBEER",
  "data": "2026-05-10",
  "ora_apertura": "22:14",
  "ora_chiusura": "23:27",
  "tavolo": "PORTO1",
  "coperti": 2,
  "items": [
    {
      "nome": "COCA ZERO",
      "qty": 2,
      "prezzo": 9.80,
      "reparto": "BAR",
      "categoria": "BIBITE",
      "iva": 22
    }
  ],
  "totale": 9.80,
  "payment": "carta",
  "customer_id": "uuid-cliente-opz",
  "isInvoice": false
}
```

**Importante:** `prezzo` per riga deve essere il **totale-riga** (qty × prezzo unitario), non il prezzo singolo. Convenzione coerente con receipt_details esistenti.

Se la chiave ha `locale` configurato (chiave POS-specifica), il campo `locale` nel body è opzionale.

### `GET resource=sales&action=list`
Scope: `sales.read`

Query: `from`, `to`, `locale`, `limit`.

---

## Loyalty (programma fedeltà)

### `GET resource=loyalty&action=balance&customer_id={uuid}`
Scope: `loyalty.read`

```json
{ "customer_id": "...", "balance": 150 }
```

### `GET resource=loyalty&action=transactions&customer_id={uuid}`
Scope: `loyalty.read`

### `POST resource=loyalty&action=transactions`
Scope: `loyalty.write`

Aggiunge una movimentazione punti (positiva = guadagno, negativa = redemption).

```json
{
  "customer_id": "uuid",
  "punti_delta": 10,
  "descrizione": "Scontrino S0043 — €9.80 = +10 punti",
  "riferimento_tipo": "pos",
  "riferimento_id": "S0043",
  "locale": "REMEMBEER"
}
```

---

## Promotions (read-only)

### `GET resource=promotions`
Scope: `promotions.read`

Query: `locale` (opzionale).

Restituisce solo promozioni con `attiva=true`, `data_inizio <= oggi`, `data_fine >= oggi` (o null).

```json
{
  "promotions": [
    { "id": "...", "nome": "Happy Hour 18-20", "tipo": "sconto_percentuale", "valore": 20, ... }
  ]
}
```

---

## Esempio cURL

```bash
# Login cliente alla cassa
curl -H "Authorization: Bearer pk_live_xxx" \
  "https://cic-saas.vercel.app/api/v1?resource=customers&action=list&telefono=3331234567"

# Registra scontrino
curl -X POST -H "Authorization: Bearer pk_live_xxx" \
  -H "Content-Type: application/json" \
  -d '{"id":"S0043","locale":"REMEMBEER","data":"2026-05-10","items":[{"nome":"COCA","qty":2,"prezzo":9.80}],"totale":9.80}' \
  "https://cic-saas.vercel.app/api/v1?resource=sales&action=create"
```

## Note di sicurezza

- Le chiavi possono essere **revocate** dalla dashboard in qualsiasi momento (effetto immediato)
- Ogni chiave ha **scopes limitati**: una chiave POS dovrebbe avere solo i scope necessari (es. niente `customers.write` se il POS non crea clienti)
- Una chiave può essere **scoped a un solo locale** (consigliato per produzione): le query verranno filtrate automaticamente
- `last_used_at` e `uses_count` sono visibili in dashboard per audit
