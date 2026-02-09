# bling-mvp (headless)

MVP (Node.js + Express) que:
- Faz OAuth do Bling v3 (authorization code) e renova via refresh_token
- Faz polling em Contas a Receber (situacoes 1 e 2) filtrando forma de pagamento e data inicial
- Quando a conta estiver **recebida (situacao=2)**, localiza o Pedido de Venda por `origem.numero` e altera a situação para **Pago**
- Mantém controle simples em JSON (`tokens.json` e `state.json`) com TTL de 24 horas

## Rodando “headless” (sem navegador)

Se você já tem tokens, pode informar no `.env`:
- `BLING_REFRESH_TOKEN` (recomendado)
- `BLING_ACCESS_TOKEN` (opcional)
- `BLING_EXPIRES_AT` (opcional; 0 força tentar refresh no primeiro uso)

No boot, se **não existir** `tokens.json`, o serviço cria automaticamente.

## Multi-contas (4+ contas)

Se você precisa rodar em **múltiplas contas Bling**, configure `BLING_ACCOUNTS` no `.env` como um JSON
com uma lista de contas, cada uma com seu `client_id`, `client_secret` e `redirect_uri`.

- OAuth por conta: `GET /auth/start?account=loja1`
- Sync em todas as contas: `POST /sync`
- Sync em uma conta: `POST /sync` com `{ "accountId": "loja1" }`

## Como rodar

```bash
npm install
cp .env.example .env
node src/server.js
```

## OAuth via navegador (se você não tem refresh_token)

1) `GET /auth/start` -> pegue `authorize_url`
2) Autorize e deixe o Bling redirecionar para seu callback (`/auth/callback?code=...`)
3) Tokens serão salvos em `tokens.json`

## Sync manual

```bash
curl -X POST http://localhost:3000/sync
```
