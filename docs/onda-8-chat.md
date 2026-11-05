# Onda 8 — chat ao vivo (substituir Discord/WhatsApp)

Tese: hackathon hoje é Frankenstein de Luma+Discord+WhatsApp+planilha.
HackaHub cobre tudo exceto chat realtime — esse é o gap.

## Escopo mínimo ("o básico pra se organizar e fazer network")

- Canal do time: privado, nasce com o time, cobre 80% do uso
- #avisos da edição: só organização posta, todos leem
- #geral da edição: banter, pergunta solta, network
- Polling 3-5s (SEM websocket — escala de 100-300 pessoas nao precisa)
- Texto + links. SEM reactions, typing, read receipt, threads

## Arquitetura

- Reusar padrões da DM (onda 6): tabelas chat_channels/chat_messages,
  paginação por cursor, rate-limit, 404 pra quem não pertence, fila offline
- Acesso: team channel = member do time; edition channels = inscrito
  aprovado ou staff; #avisos write = organizador/staff
- Moderacao: dono/organizador apaga msg, expulsa do canal
- Voz/video: NÃO construir — link Meet/Jitsi no canal resolve

## Timing

Pós-BLIS (7/11). Não shipar véspera de evento. BLIS roda com
espaços + dúvidas + DM. Próximas edições do iLab (trilhas do Lucas)
já nascem com chat.
