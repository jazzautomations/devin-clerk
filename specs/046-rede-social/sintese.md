# Síntese dos estudos (28/10/2026)

Entradas:
- 042 quebra-gelo, código lido;
- 043 gamificação;
- 044 Orkut;
- 045 conexão entre pessoas;
- 046 plano de ondas (pesquisa de Circle, Mastodon, Devpost, Colosseum e lablab, auditoria do produto atual, arquiteto e crítico).

O plano final é `plano.json`. Os ajustes abaixo vêm das conversas com o dono e valem por cima do texto do arquiteto.

1. **Tópicos estilo Reddit na comunidade** (`topicos-da-comunidade`, migration 058) entram na Onda 1. O dono pediu tópicos e feed de comunidade como centro da rede, e o plano original só tinha "espaços" na Onda 6.
2. **O bicho é um criador de personagem com cara de joguinho.** Vai pra Onda 1 com tudo liberado desde o começo: 8 espécies, 2 cores, olhos, boca, chapéu, roupa, item na mão, acessório de rosto, pose e cenário, além de sortear e desfazer. Os itens por fato verificado são extras e chegam na Onda 4. O dono achou a mecânica do quebra-gelo "forçada": personalizar é diversão, não recompensa.
3. **Encontro no evento é leve e opcional.** Missões viram sugestões desligadas por padrão. Sem narrativa obrigatória e sem academia.
4. **Recado no perfil** (a brisa do Orkut) entra no `perfil-rico`, como escopo de post `member`, com anti-corrente.
5. Sem pausa de checkpoint entre ondas. O spike de ActivityPub sai e fica o RSS aberto.
6. **Conflito de XP de encontro:** a 045 dá XP, a 043 e o plano dão 0. Vale o plano: nada de XP por encontro, like, post, comentário, repost, seguidor ou voto. O encontro alimenta o bicho e a rede.
7. 18+ na plataforma inteira (decisão do dono de 14/10). Toda superfície de contato chama `canNetwork()`.

## Execução

As ondas rodam em sequência. Dentro de cada onda as features são construídas em paralelo, uma branch por feature. Cada uma passa pelo gate completo na VPS, depois por revisão adversarial e correção. No fim da onda as branches são integradas no main, a suíte completa roda, e a onda sobe no stage e depois em prod.
