/**
 * services/chat/chatStrings.js — server-generated chat text (system messages,
 * welcome, fallbacks) in the conversation's language. English per-key fallback.
 * AI replies are generated directly in the language by the model.
 */
const S = {
  en: {
    welcome: "Hi! I'm the {brand} assistant. How can I help you today?",
    connecting: "I'm connecting you with our {role} team. Please stay on this chat — someone will join shortly.",
    joined: "{name} ({role}) joined the chat.",
    transferred: "Your chat was transferred to our {role} team.",
    askContact: "So our team can follow up if we get disconnected, could you share your email and WhatsApp number?",
    contactThanks: "Thank you! We've saved your contact details.",
    closed: "This chat has been closed. Thanks for contacting {brand}!",
    aiBack: "You're now chatting with our virtual assistant again.",
    unavailable: "Our assistant is unavailable right now. I've alerted our team and someone will reply here as soon as possible.",
    offerHuman: "Would you like me to connect you with a team member?",
    roles: { SALES: "Sales", MANAGER: "Management", IT: "Technical support", DIRECTOR: "Director's office" },
    disabled: "Chat is currently unavailable.",
  },
  fr: {
    welcome: "Bonjour ! Je suis l'assistant {brand}. Comment puis-je vous aider ?",
    connecting: "Je vous mets en relation avec notre équipe {role}. Restez sur ce chat — quelqu'un va vous rejoindre rapidement.",
    joined: "{name} ({role}) a rejoint la conversation.",
    transferred: "Votre conversation a été transférée à notre équipe {role}.",
    askContact: "Pour que notre équipe puisse vous recontacter en cas de coupure, pouvez-vous nous donner votre e-mail et votre numéro WhatsApp ?",
    contactThanks: "Merci ! Vos coordonnées ont bien été enregistrées.",
    closed: "Cette conversation est terminée. Merci d'avoir contacté {brand} !",
    aiBack: "Vous discutez de nouveau avec notre assistant virtuel.",
    unavailable: "Notre assistant est momentanément indisponible. J'ai alerté notre équipe : quelqu'un vous répondra ici dès que possible.",
    offerHuman: "Souhaitez-vous que je vous mette en relation avec un membre de l'équipe ?",
    roles: { SALES: "commerciale", MANAGER: "de direction", IT: "support technique", DIRECTOR: "de la direction générale" },
    disabled: "Le chat est actuellement indisponible.",
  },
  it: {
    welcome: "Ciao! Sono l'assistente {brand}. Come posso aiutarti?",
    connecting: "Ti sto mettendo in contatto con il nostro team {role}. Resta in chat — qualcuno ti raggiungerà a breve.",
    joined: "{name} ({role}) è entrato nella chat.",
    transferred: "La tua chat è stata trasferita al nostro team {role}.",
    askContact: "Per poterti ricontattare in caso di disconnessione, puoi indicarci la tua email e il tuo numero WhatsApp?",
    contactThanks: "Grazie! Abbiamo salvato i tuoi recapiti.",
    closed: "Questa chat è stata chiusa. Grazie per aver contattato {brand}!",
    aiBack: "Stai di nuovo chattando con il nostro assistente virtuale.",
    unavailable: "Il nostro assistente non è al momento disponibile. Ho avvisato il team: qualcuno risponderà qui il prima possibile.",
    offerHuman: "Vuoi che ti metta in contatto con un membro del team?",
    roles: { SALES: "vendite", MANAGER: "di direzione", IT: "supporto tecnico", DIRECTOR: "della direzione generale" },
    disabled: "La chat non è al momento disponibile.",
  },
};

export function chatStrings(language = "en") {
  const l = S[language] || {};
  return { ...S.en, ...l, roles: { ...S.en.roles, ...(l.roles || {}) } };
}

export function fmt(str, vars = {}) {
  return String(str).replace(/\{(\w+)\}/g, (_, k) => (vars[k] !== undefined ? vars[k] : `{${k}}`));
}
