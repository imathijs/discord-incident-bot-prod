# Google Sheets cheat sheet (DRE Incident Bot)

Snelle setup voor externe logging van incidenten naar Google Sheets.

## 1) Maak een Google Sheet
Maak een tabblad (sheet) aan met exact deze kolommen (A t/m J):
1. Status incident
2. Timestamp
3. Race
4. Gebruiker
5. Schuldig(en)
6. Divisie
7. Ronde
8. Circuit
9. Incident template
10. verhaal indiener

Tip: Zet de eerste rij als header.

## 2) Google Cloud project + Sheets API
1) Maak een Google Cloud project.
2) Schakel de **Google Sheets API** in.
3) Maak een **Service Account** aan.
4) Maak een JSON‑key voor deze service account.

## 3) Deel de sheet met de service account
Open de sheet → Share → voeg het service‑account e‑mailadres toe met Editor‑rechten.

## 4) Bot configureren
In `config.json`:
```json
{
  "googleSheetsEnabled": true,
  "googleSheetsSpreadsheetId": "SPREADSHEET_ID",
  "googleSheetsSheetName": "Incidenten"
}
```

In `.env` (kies 1 optie):
```
GOOGLE_SERVICE_ACCOUNT_JSON={"type":"service_account",...}
```
of
```
GOOGLE_SERVICE_ACCOUNT_B64=BASE64_JSON
```
of
```
GOOGLE_SERVICE_ACCOUNT_FILE=/pad/naar/service-account.json
```

## 5) Wat wordt er gelogd
- Na indienen: er wordt een nieuwe rij toegevoegd met **Status incident = New**.
- Na afhandelen: de status wordt bijgewerkt naar **Afgehandeld**.

Opmerking: stemregels voor betrokken stewards (indiener/tegenpartij) werken los van Sheets en hebben geen invloed op de logging.

## 6) Troubleshooting (kort)
- Geen logging? Controleer:
  - `googleSheetsEnabled=true`
  - juiste spreadsheet‑ID en sheetnaam
  - service account heeft toegang
  - bot herstarten na wijzigen van env/config
