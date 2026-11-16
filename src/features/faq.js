const WIKI = "https://github.com/Wavvon/Wavvon-docs/blob/main/docs";

export const QUESTIONS = [
  {
    id: "what",
    label: "What is Wavvon?",
    answer:
      "A self-hosted, federated voice and text community platform. Each community runs its own hub, and hubs can form alliances with each other.",
  },
  {
    id: "account",
    label: "Where is my account?",
    answer: `There is none. You are a keypair on your own devices, and a hub only knows your public key. Keep your recovery phrase safe: ${WIKI}/identity.md`,
  },
  {
    id: "host",
    label: "How do I host a hub?",
    answer: `One binary, with PostgreSQL bundled or your own. Start here: ${WIKI}/hub-operator-guide.md`,
  },
  {
    id: "bots",
    label: "How do I write a bot?",
    answer: `A bot is a client like any other, with a role that carries apps.register. This one runs on @wavvon/sdk: ${WIKI}/sdk.md`,
  },
];

export default {
  commands: [{ name: "faq", description: "Answers to common questions" }],
  slash: {
    faq: () => ({
      reply: {
        body: "What would you like to know?",
        components: [
          {
            type: "row",
            components: QUESTIONS.map((q) => ({ type: "button", custom_id: `faq:${q.id}`, label: q.label })),
          },
        ],
      },
    }),
  },
  components: {
    faq(_inv, id) {
      const q = QUESTIONS.find((x) => x.id === id);
      return { ephemeral_reply: { body: q ? `**${q.label}** ${q.answer}` : "I no longer know that one." } };
    },
  },
};
