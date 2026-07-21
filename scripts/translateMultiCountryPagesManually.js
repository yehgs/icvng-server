/**
 * scripts/translateMultiCountryPagesManually.js
 *
 * The automated pipeline (translateSitePage → LibreTranslate) failed almost
 * entirely for these 5 pages when it was run — see the transcript: the
 * public libretranslate.com demo endpoint (no LIBRETRANSLATE_URL/API key
 * configured) rejected the batch request outright (400s) and then got
 * hammered with dozens of unthrottled parallel fallback requests, which
 * tripped its rate limit (the wall of 429s). That endpoint-reliability
 * issue is fixed separately in utils/translationService.js (sequential,
 * delayed, retrying fallback instead of Promise.all — see that file's
 * comments), but this script exists to unblock you *right now* without
 * depending on a free, rate-limited third-party service at all:
 *
 * It writes hand-translated (well — LLM-translated, same as the rest of
 * this content, but written deliberately rather than machine-batch-
 * translated) French and Italian copy directly into the Translation
 * collection for About Us, Our Story, FAQ, Returns & Refunds, and Privacy
 * Policy — the same 5 pages updateMultiCountryPages.js seeded in English.
 *
 * Saved with autoTranslated: false ("Manual" in the admin UI), which means
 * translateSitePage()'s "don't clobber a human's work" guard will skip
 * these going forward — a future bulk "Translate all" run won't overwrite
 * them. Review them in Admin → Site Pages → (page) → FR/IT tab like any
 * other translation; edit inline there if anything needs a tweak.
 *
 * Idempotent — safe to re-run; upserts by (entityId, language).
 *
 * Run:  node scripts/translateMultiCountryPagesManually.js
 */

import dotenv from "dotenv";
import connectDB from "../config/connectDB.js";
import SitePageModel from "../models/sitePage.model.js";
import TranslationModel from "../models/translation.model.js";

dotenv.config();

// ─────────────────────────────────────────────────────────────────────────
// FRENCH
// ─────────────────────────────────────────────────────────────────────────
const FR_PAGES = {
  "about-us": {
    seo: {
      title: "À propos d'I-Coffee | Plateforme de vente de café multi-pays",
      description: "I-Coffee est une plateforme de vente de café multi-pays dont le siège est au Nigeria, reliant fournisseurs, entreprises et amateurs de café dans tous les marchés que nous desservons.",
    },
    content: {
      heroTitle: "À propos d'I-Coffee",
      heroTagline: "Une plateforme de vente de café multi-pays",
      heroSubtitle: "Créer de la valeur pour vos produits — dans chaque marché que nous desservons",
      missionText: "Révolutionner l'industrie du café dans chaque pays où nous sommes présents, en créant une plateforme fluide qui relie fournisseurs de café, entreprises et passionnés, tout en garantissant qualité, transparence et croissance mutuelle — où que vous fassiez vos achats.",
      missionQuote: "« Créer de la valeur pour vos produits » - Nous comblons le fossé entre fournisseurs de café, acheteurs et passionnés, en cultivant une culture du café florissante dans chaque pays où I-Coffee est présent.",
      whoWeAreSubtitle: "Une équipe passionnée dédiée à l'industrie du café dans tous nos marchés",
      whoWeAreImage: "https://images.unsplash.com/photo-1442512595331-e89e73853f31?w=600&h=400&fit=crop",
      whoWeAreParagraphs: [
        "I-Coffee a débuté comme la toute première plateforme de vente de café en ligne du Nigeria, et est devenue une marketplace multi-pays, reliant fournisseurs de café et passionnés dans tous les marchés que nous desservons. Nous sommes votre solution unique pour le café, les machines à café et les accessoires — quel que soit le site I-Coffee de votre pays.",
        "Notre siège social et notre centre logistique central sont situés à Ikeja, Lagos, au Nigeria, et coordonnent un réseau de livraison en expansion constante vers de nouveaux pays — le Togo est déjà opérationnel, et d'autres marchés suivront. Chaque pays où nous sommes présents bénéficie de tarifs, d'options de paiement et de livraison adaptés à ses besoins locaux.",
        "Notre équipe de direction internationale structurée, associée à un personnel dédié dans chaque marché, s'efforce de vous offrir la meilleure expérience café possible, où que vous soyez. Nous maintenons un taux de livraison réussie de 97 % au Nigeria, notre marché le plus établi, et nous construisons ce même niveau de fiabilité à mesure que nous nous développons dans de nouveaux pays.",
        "Le paiement reste toujours local : les clients payant en Naira nigérian sont pris en charge par Paystack, tandis que les clients payant dans toute autre devise prise en charge sont servis par Stripe — quel que soit votre mode de paiement, il fonctionne comme vous vous y attendez sur votre marché.",
      ],
      achievements: [
        { iconKey: "users", number: "797+", labelKey: "statCustomers" },
        { iconKey: "coffee", number: "858+", labelKey: "statProducts" },
        { iconKey: "handshake", number: "65+", labelKey: "statBrands" },
        { iconKey: "globe", number: "2+", labelKey: "statStates" },
      ],
      commitmentParagraphs: [
        "Chez I-Coffee, nous nous engageons à maintenir les normes de qualité et de service les plus élevées dans chaque pays où nous opérons. Chaque produit sur notre plateforme est soigneusement vérifié pour garantir authenticité et excellence, quel que soit le marché d'expédition.",
        "Nous travaillons en étroite collaboration avec nos partenaires fournisseurs dans chaque marché pour vous garantir de ne recevoir que des produits authentiques et frais. Notre plateforme facilite des transactions transparentes, des livraisons ponctuelles et un service client réactif — avec des prix et paiements toujours affichés dans votre devise locale.",
        "Que vous soyez propriétaire d'un café à la recherche d'approvisionnements en gros, une entreprise en quête de machines de qualité, ou un passionné explorant de nouvelles saveurs, I-Coffee est votre partenaire de confiance dans votre parcours café, où que vous soyez.",
      ],
      ctaTitle: "Rejoignez la communauté I-Coffee",
      ctaText: "Que vous soyez un fournisseur cherchant à élargir votre portée ou un amateur de café en quête de produits de qualité, nous sommes là pour vous — dans chaque pays où nous sommes présents.",
    },
  },

  "our-story": {
    seo: {
      title: "Notre histoire | I-Coffee",
      description: "Comment I-Coffee est passée d'une jeune entreprise lagosienne à une plateforme de vente de café multi-pays.",
    },
    content: {
      heroTitle: "Notre histoire",
      heroTagline: "De la vision à la réalité",
      heroSubtitle: "L'histoire de la croissance d'I-Coffee, d'une jeune entreprise lagosienne à une plateforme de vente de café multi-pays",
      beginningTitle: "Tout a commencé à Lagos",
      beginningParagraphs: [
        "Dans la ville trépidante de Lagos, au Nigeria, une plateforme de vente révolutionnaire a vu le jour, changeant la façon dont les passionnés de café et les entreprises se connectaient. I-Coffee, née de l'esprit d'entrepreneurs passionnés, avait pour ambition de combler le fossé entre fournisseurs de café, acheteurs et amateurs.",
        "L'équipe de direction visionnaire de la plateforme avait un objectif clair : créer un guichet unique pour tout ce qui touche au café, où les utilisateurs pourraient acheter, vendre et échanger facilement grains de café, machines et accessoires. Grâce à une interface conviviale et des fonctionnalités robustes, I-Coffee a rapidement gagné en popularité — et ce qui a commencé à Lagos a toujours été conçu pour grandir au-delà de ses frontières.",
      ],
      successStoryBadge: "Histoire de réussite",
      successStoryTitle: "La transformation du café de Princess",
      successStoryParagraphs: [
        "Un jour, Princess, jeune propriétaire d'un café, est tombée sur I-Coffee en cherchant des grains d'Arabica de haute qualité. Elle a été impressionnée par le vaste choix et les prix compétitifs de la plateforme.",
        "Elle s'est mise en relation avec un fournisseur réputé, a négocié un accord, et a reçu ses grains en quelques jours seulement. La qualité a dépassé ses attentes, et les ventes de son café ont grimpé en flèche.",
        "Princess est devenue une cliente fidèle d'I-Coffee, et son histoire à succès en a inspiré bien d'autres à rejoindre notre communauté.",
      ],
      successStoryImage: "https://images.unsplash.com/photo-1509042239860-f550ce710b93?w=600&h=400&fit=crop",
      timeline: [
        { year: "Les débuts", title: "Une vision née à Lagos", description: "Dans la ville trépidante de Lagos, au Nigeria, des entrepreneurs passionnés ont identifié une lacune dans l'industrie du café - le besoin d'une plateforme reliant fournisseurs, acheteurs et passionnés.", iconKey: "lightbulb" },
        { year: "Le lancement", title: "La plateforme I-Coffee est mise en ligne", description: "Notre plateforme de vente révolutionnaire a vu le jour avec une mission claire : créer un guichet unique pour tout ce qui touche au café, avec des fonctionnalités conviviales et des prix compétitifs.", iconKey: "rocket" },
        { year: "Premier succès", title: "Princess trouve ses grains", description: "Princess, jeune propriétaire d'un café, a découvert I-Coffee en cherchant des grains d'Arabica de haute qualité. Elle s'est connectée à des fournisseurs, et les ventes de son café ont grimpé en flèche.", iconKey: "star" },
        { year: "Une communauté grandissante", title: "Le bouche-à-oreille se répand à travers le Nigeria", description: "À mesure que les histoires à succès se multipliaient, la communauté I-Coffee grandissait. Les fournisseurs mettaient en avant des grains haut de gamme tandis que les acheteurs découvraient de nouvelles saveurs et développaient leurs activités.", iconKey: "users" },
        { year: "Le passage au multi-pays", title: "Une expansion au-delà du Nigeria", description: "I-Coffee s'est lancée au Togo, son premier marché en dehors du Nigeria — apportant la même plateforme, avec des tarifs, paiements et livraisons locaux, à un nouveau pays.", iconKey: "award" },
      ],
      impactTitle: "Notre impact",
      impactSubtitle: "À mesure que le bouche-à-oreille se répandait, la communauté I-Coffee grandissait — et continuait de grandir au-delà des frontières",
      impactStats: [
        { iconKey: "coffee", title: "Qualité supérieure", text: "Les fournisseurs mettent en avant leurs meilleurs grains" },
        { iconKey: "users", title: "Un réseau grandissant", text: "Les acheteurs découvrent chaque jour de nouvelles saveurs" },
        { iconKey: "rocket", title: "Une croissance multi-pays", text: "La même plateforme, adaptée à chaque nouveau marché" },
      ],
      valueTitle: "Créer de la valeur pour vos produits",
      valueSubtitle: "Notre slogan reflète notre engagement — dans chaque pays où nous sommes présents",
      valueParagraphs: [
        "Fidèle à son slogan « Créer de la valeur pour vos produits », I-Coffee a continué d'innover, en introduisant des fonctionnalités telles que la vente de machines à café, des ressources pédagogiques et des connexions renforcées entre fournisseurs et acheteurs.",
        "L'impact de la plateforme a dépassé les frontières du Nigeria. I-Coffee est désormais une marketplace multi-pays — apportant la même croissance, les mêmes connexions et une culture du café florissante à de nouveaux marchés comme le Togo, avec des tarifs et paiements adaptés à chaque devise locale.",
      ],
      principles: [
        { iconKey: "coffee", title: "La qualité avant tout", description: "Chaque produit sur notre plateforme répond à des normes de qualité strictes, dans chaque marché." },
        { iconKey: "handshake", title: "Créer des liens", description: "Nous réunissons fournisseurs et acheteurs au sein d'une marketplace fluide, où qu'ils se trouvent." },
        { iconKey: "heart", title: "La réussite du client", description: "Votre croissance et votre satisfaction sont la mesure de notre réussite." },
      ],
      closingTitle: "L'aventure continue",
      closingParagraphs: [
        "Aujourd'hui, I-Coffee est un pôle de vente de café multi-pays — opérationnel au Nigeria et au Togo, et en pleine croissance — mais notre histoire est loin d'être terminée. Nous continuons d'innover, de nous développer et de créer de la valeur pour chaque membre de notre communauté.",
        "Que vous soyez un fournisseur en quête de croissance, une entreprise à la recherche de produits de qualité, ou un passionné de café explorant de nouveaux horizons, vous faites partie de notre histoire — où que vous soyez dans le monde en lisant ces lignes.",
      ],
    },
  },

  faq: {
    seo: {
      title: "FAQ | I-Coffee",
      description: "Réponses aux questions courantes sur les commandes, la livraison, les paiements dans votre devise locale et plus encore.",
    },
    content: {
      heroTitle: "Foire aux questions",
      heroSubtitle: "Trouvez des réponses aux questions courantes sur les commandes, la livraison, les paiements et plus encore",
      categories: [
        { id: "all", name: "Toutes les questions" },
        { id: "ordering", name: "Commandes" },
        { id: "shipping", name: "Livraison" },
        { id: "payment", name: "Paiement" },
        { id: "returns", name: "Retours" },
        { id: "account", name: "Compte" },
      ],
      faqs: [
        { category: "ordering", question: "I-Coffee est-elle présente dans plusieurs pays ?", answer: "Oui — I-Coffee est une plateforme multi-pays. Chaque pays dispose de son propre site (par exemple i-coffee.ng pour le Nigeria et i-coffee.tg pour le Togo), avec des tarifs, des options de livraison et des moyens de paiement adaptés à ce marché, ainsi qu'un contenu disponible dans les langues pertinentes pour ce pays." },
        { category: "ordering", question: "Comment passer une commande sur I-Coffee ?", answer: "Parcourez nos produits, ajoutez des articles à votre panier, puis passez à la caisse. Vous pouvez commander en tant qu'invité ou créer un compte pour un passage en caisse plus rapide et un suivi de commande." },
        { category: "ordering", question: "Puis-je modifier ou annuler ma commande après l'avoir passée ?", answer: "Les commandes peuvent être modifiées ou annulées dans les 2 heures suivant leur passage. Contactez immédiatement notre service client via la page Contactez-nous de votre pays." },
        { category: "ordering", question: "Quels moyens de paiement acceptez-vous ?", answer: "Les moyens de paiement dépendent de votre pays. Au Nigeria, les paiements sont traités en toute sécurité via Paystack — cartes, virements bancaires et USSD, tous en Naira. Dans tous les autres pays que nous desservons, les paiements sont traités via Stripe, prenant en charge les cartes locales et internationales dans votre devise locale." },
        { category: "ordering", question: "Y a-t-il une quantité minimale de commande ?", answer: "Il n'y a pas de quantité minimale de commande pour les clients réguliers. Cependant, les commandes en gros peuvent bénéficier de remises spéciales. Contactez-nous pour connaître nos tarifs de gros." },
        { category: "shipping", question: "Dans quelles zones livrez-vous ?", answer: "Nous livrons actuellement au Nigeria et au Togo, avec d'autres pays qui seront ajoutés au fil du temps. Chaque site I-Coffee national n'affiche que les zones et options de livraison disponibles sur ce marché — consultez la page Politique de livraison de votre site I-Coffee local pour connaître la couverture exacte." },
        { category: "shipping", question: "Combien de temps prend la livraison ?", answer: "Les délais de livraison varient selon le pays et la localisation au sein de ce pays. Consultez la page Politique de livraison de votre site I-Coffee local pour connaître les délais exacts dans votre région." },
        { category: "shipping", question: "Quels sont vos frais de livraison ?", answer: "Les frais de livraison varient selon le pays, la localisation et le poids de la commande, et sont toujours affichés dans votre devise locale au moment du paiement. Les seuils de livraison gratuite varient également selon le marché — consultez la page Politique de livraison de votre pays pour les détails exacts." },
        { category: "shipping", question: "Comment puis-je suivre ma commande ?", answer: "Une fois votre commande expédiée, vous recevrez un numéro de suivi par e-mail et SMS. Vous pouvez suivre votre commande en temps réel depuis votre tableau de bord ou notre page de suivi." },
        { category: "shipping", question: "Quel est votre taux de réussite de livraison ?", answer: "Nous maintenons un taux de livraison réussie de 97 % au Nigeria, notre marché le plus établi, et nous construisons ce même niveau de fiabilité à mesure que nous nous développons dans de nouveaux pays." },
        { category: "payment", question: "Mes informations de paiement sont-elles sécurisées ?", answer: "Oui, absolument. Tous les paiements sont traités via Paystack (Nigeria) ou Stripe (tous les autres pays), qui utilisent tous deux un chiffrement SSL conforme aux normes du secteur et des passerelles de paiement sécurisées. Nous ne stockons jamais l'intégralité de vos coordonnées bancaires sur nos serveurs." },
        { category: "payment", question: "Proposez-vous le paiement à la livraison ?", answer: "Le paiement à la livraison est disponible dans certaines zones de certains pays. Lorsque cette option est disponible, elle s'affichera au moment du paiement pour votre adresse de livraison." },
        { category: "payment", question: "Puis-je obtenir une facture pour mon achat ?", answer: "Oui, une facture est automatiquement générée et envoyée par e-mail après l'achat, dans votre devise locale. Vous pouvez également télécharger vos factures depuis votre tableau de bord." },
        { category: "returns", question: "Quelle est votre politique de retour ?", answer: "Nous acceptons les retours dans les 7 jours suivant l'achat. Les produits doivent être dans leur état d'origine, avec tous les emballages et accessoires. Des frais de réapprovisionnement de 20 % s'appliquent, sauf en cas de défaut de fabrication. Consultez notre page Politique de retour pour tous les détails." },
        { category: "returns", question: "Comment initier un retour ?", answer: "Contactez le service client dans les 7 jours suivant la réception de votre commande, via la page Contactez-nous de votre pays. Indiquez votre numéro de commande et le motif du retour. Nous vous délivrerons un numéro d'autorisation de retour ainsi que des instructions." },
        { category: "returns", question: "Quand vais-je recevoir mon remboursement ?", answer: "Les remboursements sont traités dans un délai de 5 à 10 jours ouvrés après réception et vérification du produit retourné. Les remboursements sont crédités sur votre moyen de paiement d'origine, dans votre devise d'origine." },
        { category: "returns", question: "Qui paie les frais de retour ?", answer: "Les clients sont responsables des frais de retour, sauf si le retour est dû à une erreur de notre part ou à un produit défectueux. Nous recommandons d'utiliser un service d'expédition avec suivi." },
        { category: "account", question: "Ai-je besoin d'un compte pour acheter ?", answer: "Non, vous pouvez commander en tant qu'invité. Cependant, créer un compte vous permet de suivre vos commandes, d'enregistrer vos adresses, de consulter votre historique de commandes et de profiter d'un passage en caisse plus rapide." },
        { category: "account", question: "Comment réinitialiser mon mot de passe ?", answer: "Cliquez sur « Mot de passe oublié » sur la page de connexion. Saisissez votre adresse e-mail et nous vous enverrons un lien de réinitialisation. Suivez les instructions de l'e-mail pour définir un nouveau mot de passe." },
        { category: "account", question: "Puis-je modifier mon adresse de livraison ?", answer: "Oui, vous pouvez ajouter, modifier ou supprimer des adresses dans les paramètres de votre compte. Vous pouvez également saisir une adresse différente lors du paiement." },
        { category: "account", question: "Comment m'abonner à votre newsletter ?", answer: "Saisissez votre e-mail dans le champ d'inscription à la newsletter en bas de n'importe quelle page. Vous recevrez des offres exclusives, des conseils sur le café et des actualités sur les nouveaux produits." },
        { category: "ordering", question: "Quels types de produits café vendez-vous ?", answer: "Nous proposons une gamme complète comprenant des grains de café, des capsules, du café moulu, du café instantané, des machines à café, des accessoires, des sirops, des cafetières à froid, et même des produits de beauté sur le thème du café — plus de 858 produits provenant de plus de 65 marques locales et internationales, disponibles dans tous les pays que nous desservons." },
        { category: "ordering", question: "Proposez-vous des tarifs de gros ?", answer: "Oui ! Nous proposons des tarifs de gros compétitifs pour les commandes en volume. Contactez-nous via la page Contactez-nous de votre pays pour discuter de vos besoins et de nos tarifs." },
        { category: "shipping", question: "Puis-je planifier un créneau de livraison ?", answer: "Bien que nous ne puissions pas garantir un horaire de livraison précis, vous pouvez ajouter des instructions de livraison dans les notes de votre commande. Notre équipe fera de son mieux pour respecter vos préférences." },
        { category: "payment", question: "Acceptez-vous les cartes de crédit internationales ?", answer: "Oui. Selon votre pays, les paiements sont traités via Paystack (Nigeria) ou Stripe (tous les autres pays), qui prennent tous deux en charge les principales cartes internationales." },
      ],
      ctaTitle: "Vous avez encore des questions ?",
      ctaText: "Notre équipe de service client est là pour vous aider",
      ctaPhone: "+2348039827194",
    },
  },

  "return-policy": {
    seo: {
      title: "Politique de retour et de remboursement | I-Coffee",
      description: "Conditions de retour, processus et délais de remboursement d'I-Coffee — la même politique dans chaque pays où nous sommes présents.",
    },
    content: {
      heroTitle: "Politique de retour et de remboursement",
      heroSubtitle: "Votre satisfaction est notre priorité, dans chaque pays où nous sommes présents. Consultez notre politique de retour pour garantir une expérience sans accroc.",
      supplierNoticeTitle: "Avis important pour les fournisseurs",
      supplierNoticeText: "Les fournisseurs inscrits sur la plateforme I-Coffee, dans tous les pays, doivent s'assurer de comprendre et de respecter cette politique de remboursement afin de garantir un processus de transaction fluide et transparent avec les clients.",
      returnConditions: [
        { iconKey: "clock", title: "Délai de retour de 7 jours", description: "Les clients doivent retourner les produits dans les 7 jours suivant la date d'achat." },
        { iconKey: "box", title: "État d'origine", description: "Les produits doivent être retournés dans leur état d'origine, non ouverts et non utilisés, avec tout leur emballage d'origine." },
        { iconKey: "shield", title: "Preuve d'achat", description: "Le reçu original ou une preuve d'achat doit être fourni avec le retour." },
        { iconKey: "money", title: "Frais de réapprovisionnement", description: "Des frais de traitement de 20 % par unité ainsi que les frais de transport seront déduits, sauf en cas de défaut de fabrication." },
      ],
      returnProcess: [
        { step: "1", title: "Contactez le service client", description: "Contactez notre équipe d'assistance dans les 7 jours suivant l'achat via la page Contactez-nous de votre pays." },
        { step: "2", title: "Autorisation de retour", description: "Recevez un numéro d'autorisation de retour ainsi que les instructions de retour de notre équipe." },
        { step: "3", title: "Emballez votre article", description: "Emballez soigneusement le produit dans son état d'origine, avec tous les accessoires et documents." },
        { step: "4", title: "Expédiez le produit", description: "Envoyez le colis à l'adresse de retour indiquée. Conservez votre numéro de suivi." },
        { step: "5", title: "Vérification", description: "Notre équipe vérifiera l'état du produit retourné à sa réception." },
        { step: "6", title: "Traitement du remboursement", description: "Le remboursement sera émis après vérification, déduction faite des frais applicables, dans votre devise de paiement d'origine." },
      ],
      refundTimelineText: "Les remboursements seront émis après vérification du produit retourné et déduction des frais applicables. Le processus de remboursement prend généralement 5 à 10 jours ouvrés après réception et vérification de votre retour. Le remboursement sera crédité sur votre moyen de paiement d'origine — via Paystack au Nigeria, ou via Stripe dans tous les autres pays que nous desservons.",
      deductionHandlingFee: "20 % du coût du produit par unité",
      deductionTransportCost: "Frais de transport réels",
      deductionException: "Aucune déduction en cas de défaut de fabrication",
      eligibleForFullRefund: [
        "Défauts de fabrication constatés à la livraison",
        "Produits endommagés pendant le transport",
        "Articles erronés expédiés par le fournisseur",
        "Produits significativement différents de leur description",
        "Produits présentant des problèmes de qualité signalés immédiatement",
      ],
      nonReturnableItems: [
        "Produits avec sceaux brisés ou emballage ouvert",
        "Produits utilisés ou endommagés du fait du client",
        "Produits sans emballage ou accessoires d'origine",
        "Produits périmés achetés en connaissance de cause",
        "Mélanges de café personnalisés ou sur mesure",
        "Produits au-delà du délai de retour de 7 jours",
      ],
      additionalInfo: [
        { label: "Produits périmés", text: "Les produits périmés ne doivent jamais être livrés aux clients. Si vous recevez un produit périmé, contactez-nous immédiatement via la page Contactez-nous de votre pays pour un remboursement intégral." },
        { label: "Responsabilité du fournisseur", text: "Les fournisseurs sont responsables de la qualité des produits qu'ils livrent. Les retours dus à une erreur du fournisseur n'entraîneront aucuns frais de traitement pour les clients." },
        { label: "Frais de retour", text: "Les clients sont responsables des frais de retour, sauf si le retour est dû à une erreur de notre part ou à un défaut du produit." },
        { label: "Politique d'échange", text: "Nous proposons actuellement uniquement des remboursements. Si vous souhaitez un produit différent, veuillez passer une nouvelle commande après réception de votre remboursement." },
      ],
      contactPhone: "+234 800 000 0000",
      contactPhoneHours: "Lun-Ven : 9h - 18h",
      contactEmail: "support@i-coffee.ng",
      contactEmailNote: "Réponse sous 24 heures. Il s'agit de la ligne d'assistance du siège d'I-Coffee — certains pays disposent également de leurs propres coordonnées locales sur la page Contactez-nous.",
    },
  },

  "privacy-policy": {
    seo: {
      title: "Politique de confidentialité | I-Coffee",
      description: "Comment I-Coffee collecte, utilise et protège vos informations, dans chaque pays où nous opérons.",
    },
    content: {
      lastUpdated: "Dernière mise à jour : novembre 2025",
      introParagraphs: [
        "Chez I-Coffee, nous nous engageons à protéger votre vie privée et à garantir la sécurité de vos informations personnelles, dans chaque pays où I-Coffee est présente. Cette politique de confidentialité explique comment nous collectons, utilisons, divulguons et protégeons vos informations lorsque vous utilisez notre plateforme.",
        "En utilisant I-Coffee — sur l'un quelconque de nos sites nationaux — vous consentez aux pratiques de données décrites dans cette politique. Si vous n'acceptez pas cette politique, veuillez ne pas utiliser notre plateforme.",
      ],
      dataTypes: [
        { iconKey: "userShield", title: "Informations personnelles", items: ["Nom et coordonnées", "Adresse e-mail", "Numéro de téléphone", "Adresse de livraison", "Informations sur l'entreprise (le cas échéant)"] },
        { iconKey: "database", title: "Données de transaction", items: ["Historique des commandes", "Informations de paiement", "Préférences d'achat", "Historique des communications", "Activité du compte"] },
        { iconKey: "cookie", title: "Données techniques", items: ["Adresse IP", "Type et version du navigateur", "Informations sur l'appareil", "Cookies et données d'utilisation", "Données de localisation"] },
      ],
      useCards: [
        { title: "Traitement des commandes", text: "Traiter et exécuter vos commandes, gérer les paiements (via Paystack ou Stripe, selon votre pays), et fournir un support client.", color: "green" },
        { title: "Communication", text: "Envoyer des confirmations de commande, des mises à jour de livraison, et répondre à vos demandes.", color: "blue" },
        { title: "Amélioration de la plateforme", text: "Analyser les habitudes d'utilisation pour améliorer nos services, fonctionnalités et l'expérience utilisateur dans chaque marché que nous desservons.", color: "purple" },
        { title: "Marketing", text: "Envoyer des offres promotionnelles, des newsletters et des actualités (avec votre consentement).", color: "orange" },
        { title: "Sécurité et prévention de la fraude", text: "Détecter et prévenir les activités frauduleuses, protéger contre les menaces de sécurité.", color: "red" },
        { title: "Conformité légale", text: "Respecter les obligations légales et faire appliquer nos conditions et politiques.", color: "indigo" },
      ],
      securityIntro: "Nous mettons en œuvre des mesures de sécurité conformes aux normes du secteur pour protéger vos informations personnelles, où que vous soyez :",
      securityMeasures: [
        "Chiffrement SSL pour la transmission des données",
        "Passerelles de paiement sécurisées (Paystack et Stripe)",
        "Audits de sécurité réguliers",
        "Contrôles d'accès et authentification",
        "Systèmes de sauvegarde et de récupération des données",
        "Formation des employés à la protection des données",
      ],
      securityDisclaimer: "Bien que nous nous efforcions de protéger vos informations, aucune méthode de transmission sur Internet n'est sécurisée à 100 %. Nous ne pouvons garantir une sécurité absolue.",
      sharingSections: [
        { title: "Avec les fournisseurs", text: "Nous partageons les informations nécessaires avec les fournisseurs de votre pays pour exécuter vos commandes, y compris l'adresse de livraison et les coordonnées." },
        { title: "Avec les prestataires de services", text: "Nous travaillons avec des prestataires tiers pour le traitement des paiements (Paystack, Stripe), la livraison et l'analyse. Ces prestataires sont contractuellement tenus de protéger vos informations." },
        { title: "Pour des raisons légales", text: "Nous pouvons divulguer des informations lorsque la loi l'exige, pour protéger nos droits, ou en réponse à des procédures judiciaires." },
      ],
      sharingNotice: "Nous ne vendons pas vos informations personnelles à des tiers.",
      yourRights: [
        { title: "Accès", description: "Demander une copie de vos données personnelles" },
        { title: "Rectification", description: "Mettre à jour ou corriger des informations inexactes" },
        { title: "Suppression", description: "Demander la suppression de vos données personnelles" },
        { title: "Portabilité", description: "Recevoir vos données dans un format structuré" },
        { title: "Opposition", description: "Vous opposer au traitement de vos données" },
        { title: "Retrait du consentement", description: "Retirer votre consentement au traitement des données" },
      ],
      rightsContactEmail: "customercare@i-coffee.ng",
      cookiesIntro: "Nous utilisons des cookies et des technologies de suivi similaires pour améliorer votre expérience sur notre plateforme. Les cookies sont de petits fichiers stockés sur votre appareil qui nous aident à :",
      cookiesList: ["Mémoriser vos préférences et paramètres", "Vous maintenir connecté à votre compte", "Analyser votre utilisation de notre plateforme", "Fournir du contenu et des recommandations personnalisés", "Améliorer les performances et la sécurité de la plateforme"],
      cookiesOutro: "Vous pouvez gérer les cookies via les paramètres de votre navigateur. Cependant, la désactivation des cookies peut affecter votre capacité à utiliser certaines fonctionnalités de notre plateforme.",
      retentionIntro: "Nous conservons vos informations personnelles aussi longtemps que nécessaire pour :",
      retentionList: ["Réaliser les finalités décrites dans cette politique de confidentialité", "Respecter les obligations légales", "Résoudre les litiges et faire appliquer les accords", "Tenir des registres commerciaux"],
      retentionOutro: "Lorsque nous n'avons plus besoin de vos informations, nous les supprimons ou les anonymisons de manière sécurisée, conformément aux lois applicables.",
      childrenText: "Notre plateforme n'est pas destinée aux enfants de moins de 18 ans. Nous ne collectons pas sciemment d'informations personnelles auprès d'enfants. Si vous pensez que nous avons collecté des informations concernant un enfant, veuillez nous contacter immédiatement.",
      transferParagraphs: [
        "Vos informations peuvent être transférées et traitées dans des pays autres que votre pays de résidence — y compris le Nigeria, où se trouve le siège d'I-Coffee, ainsi que tout autre pays où I-Coffee opère, comme le Togo. Nous veillons à ce que des garanties appropriées soient en place pour protéger vos informations, conformément à cette politique de confidentialité.",
        "En utilisant notre plateforme, vous consentez au transfert de vos informations vers le Nigeria et les autres pays où nous opérons.",
      ],
      updatesText: "Nous pouvons mettre à jour cette politique de confidentialité de temps à autre. Les modifications seront publiées sur cette page avec une date de « dernière mise à jour » actualisée. Nous vous encourageons à consulter cette politique périodiquement. Votre utilisation continue de notre plateforme après ces modifications vaut acceptation de la politique mise à jour.",
      contactEmail: "customercare@i-coffee.ng",
      contactPhone: "+234 805 242 3935",
      contactPhoneHref: "tel:+2348052423935",
      contactAddress: "3 Kaffi Street, Alausa, Ikeja, Lagos, Nigeria (siège social d'I-Coffee)",
    },
  },
};

// ─────────────────────────────────────────────────────────────────────────
// ITALIAN
// ─────────────────────────────────────────────────────────────────────────
const IT_PAGES = {
  "about-us": {
    seo: {
      title: "Chi è I-Coffee | Piattaforma multi-paese per il commercio di caffè",
      description: "I-Coffee è una piattaforma multi-paese per il commercio di caffè con sede in Nigeria, che collega fornitori, aziende e amanti del caffè in ogni mercato in cui operiamo.",
    },
    content: {
      heroTitle: "Chi è I-Coffee",
      heroTagline: "Una piattaforma multi-paese per il commercio di caffè",
      heroSubtitle: "Creare valore per i tuoi prodotti — in ogni mercato in cui operiamo",
      missionText: "Rivoluzionare l'industria del caffè in ogni paese in cui operiamo, creando una piattaforma fluida che collega fornitori di caffè, aziende e appassionati, garantendo al contempo qualità, trasparenza e crescita reciproca — ovunque tu stia acquistando.",
      missionQuote: "\"Creare valore per i tuoi prodotti\" - Colmiamo il divario tra fornitori di caffè, acquirenti e appassionati, promuovendo una cultura del caffè fiorente in ogni paese in cui I-Coffee è presente.",
      whoWeAreSubtitle: "Un team appassionato dedicato al settore del caffè in tutti i nostri mercati",
      whoWeAreImage: "https://images.unsplash.com/photo-1442512595331-e89e73853f31?w=600&h=400&fit=crop",
      whoWeAreParagraphs: [
        "I-Coffee è nata come la prima piattaforma di commercio di caffè online della Nigeria ed è cresciuta fino a diventare un marketplace multi-paese, collegando fornitori di caffè e appassionati in ogni mercato in cui operiamo. Siamo la tua soluzione unica per caffè, macchine da caffè e accessori — qualunque sia il sito I-Coffee del tuo paese.",
        "La nostra sede centrale e il nostro hub logistico si trovano a Ikeja, Lagos, in Nigeria, e coordinano una rete di consegna in continua espansione verso nuovi paesi — il Togo è già operativo, con altri mercati in arrivo. Ogni paese in cui operiamo beneficia di prezzi, opzioni di pagamento e consegna su misura per le esigenze locali.",
        "Il nostro team di gestione internazionale strutturato, insieme al personale dedicato in ogni mercato, lavora per offrirti la migliore esperienza caffè ovunque tu sia. Manteniamo un tasso di consegna riuscita del 97% in Nigeria, il nostro mercato più consolidato, e stiamo costruendo lo stesso standard di affidabilità man mano che cresciamo in nuovi paesi.",
        "Il pagamento è sempre locale: i clienti che pagano in Naira nigeriana sono serviti da Paystack, mentre i clienti che pagano in qualsiasi altra valuta supportata sono serviti da Stripe — qualunque sia il tuo metodo di pagamento, funziona come ti aspetteresti nel tuo mercato.",
      ],
      achievements: [
        { iconKey: "users", number: "797+", labelKey: "statCustomers" },
        { iconKey: "coffee", number: "858+", labelKey: "statProducts" },
        { iconKey: "handshake", number: "65+", labelKey: "statBrands" },
        { iconKey: "globe", number: "2+", labelKey: "statStates" },
      ],
      commitmentParagraphs: [
        "In I-Coffee, ci impegniamo a mantenere i più alti standard di qualità e servizio in ogni paese in cui operiamo. Ogni prodotto sulla nostra piattaforma viene attentamente verificato per garantirne autenticità ed eccellenza, indipendentemente dal mercato di spedizione.",
        "Collaboriamo strettamente con i nostri fornitori partner in ogni mercato per garantirti di ricevere solo prodotti autentici e freschi. La nostra piattaforma facilita transazioni trasparenti, consegne puntuali e un'assistenza clienti reattiva — con prezzi e pagamenti sempre mostrati nella tua valuta locale.",
        "Che tu sia il proprietario di una caffetteria alla ricerca di forniture all'ingrosso, un'azienda in cerca di macchine di qualità, o un appassionato in cerca di nuovi sapori, I-Coffee è il tuo partner di fiducia nel tuo percorso nel mondo del caffè, ovunque tu sia.",
      ],
      ctaTitle: "Unisciti alla community I-Coffee",
      ctaText: "Che tu sia un fornitore desideroso di ampliare la tua portata o un amante del caffè in cerca di prodotti di qualità, siamo qui per te — in ogni paese in cui operiamo.",
    },
  },

  "our-story": {
    seo: {
      title: "La nostra storia | I-Coffee",
      description: "Come I-Coffee è cresciuta da startup di Lagos a piattaforma multi-paese per il commercio di caffè.",
    },
    content: {
      heroTitle: "La nostra storia",
      heroTagline: "Dalla visione alla realtà",
      heroSubtitle: "Il percorso che ha portato I-Coffee da startup di Lagos a piattaforma multi-paese per il commercio di caffè",
      beginningTitle: "Tutto è iniziato a Lagos",
      beginningParagraphs: [
        "Nella vivace città di Lagos, in Nigeria, è nata una piattaforma di commercio rivoluzionaria, che ha cambiato il modo in cui gli appassionati di caffè e le aziende si connettevano. I-Coffee, ideata da imprenditori appassionati, si proponeva di colmare il divario tra fornitori di caffè, acquirenti e appassionati.",
        "Il team di gestione visionario della piattaforma aveva un obiettivo chiaro: creare un punto di riferimento unico per tutto ciò che riguarda il caffè, dove gli utenti potessero acquistare, vendere e scambiare facilmente chicchi di caffè, macchine e accessori. Grazie a un'interfaccia intuitiva e funzionalità solide, I-Coffee ha rapidamente guadagnato terreno — e ciò che è iniziato a Lagos è sempre stato pensato per crescere oltre i suoi confini.",
      ],
      successStoryBadge: "Storia di successo",
      successStoryTitle: "La trasformazione della caffetteria di Princess",
      successStoryParagraphs: [
        "Un giorno, Princess, una giovane proprietaria di caffetteria, si è imbattuta in I-Coffee mentre cercava chicchi di Arabica di alta qualità. È rimasta colpita dall'ampia selezione e dai prezzi competitivi della piattaforma.",
        "Si è messa in contatto con un fornitore affidabile, ha negoziato un accordo e ha ricevuto i suoi chicchi in pochi giorni. La qualità ha superato le sue aspettative e le vendite della sua caffetteria sono salite alle stelle.",
        "Princess è diventata una cliente fedele di I-Coffee, e la sua storia di successo ha ispirato molti altri a unirsi alla nostra community.",
      ],
      successStoryImage: "https://images.unsplash.com/photo-1509042239860-f550ce710b93?w=600&h=400&fit=crop",
      timeline: [
        { year: "Gli inizi", title: "Una visione nata a Lagos", description: "Nella vivace città di Lagos, in Nigeria, imprenditori appassionati hanno individuato una lacuna nel settore del caffè - la necessità di una piattaforma che collegasse fornitori, acquirenti e appassionati.", iconKey: "lightbulb" },
        { year: "Il lancio", title: "La piattaforma I-Coffee va online", description: "La nostra piattaforma di commercio rivoluzionaria è nata con una missione chiara: creare un punto di riferimento unico per tutto ciò che riguarda il caffè, con funzionalità intuitive e prezzi competitivi.", iconKey: "rocket" },
        { year: "Primo successo", title: "Princess trova i suoi chicchi", description: "Princess, giovane proprietaria di caffetteria, ha scoperto I-Coffee cercando chicchi di Arabica di alta qualità. Si è collegata con i fornitori, e le vendite della sua caffetteria sono salite alle stelle.", iconKey: "star" },
        { year: "Una community in crescita", title: "La voce si diffonde in tutta la Nigeria", description: "Man mano che le storie di successo si moltiplicavano, la community di I-Coffee cresceva. I fornitori mettevano in mostra chicchi pregiati mentre gli acquirenti scoprivano nuovi sapori ed espandevano le proprie attività.", iconKey: "users" },
        { year: "Il passaggio multi-paese", title: "Espansione oltre la Nigeria", description: "I-Coffee ha debuttato in Togo, il suo primo mercato al di fuori della Nigeria — portando la stessa piattaforma, con prezzi, pagamenti e consegne locali, in un nuovo paese.", iconKey: "award" },
      ],
      impactTitle: "Il nostro impatto",
      impactSubtitle: "Man mano che la voce si diffondeva, la community di I-Coffee cresceva — e continuava a crescere oltre i confini",
      impactStats: [
        { iconKey: "coffee", title: "Qualità superiore", text: "I fornitori mettono in mostra i loro migliori chicchi" },
        { iconKey: "users", title: "Una rete in crescita", text: "Gli acquirenti scoprono ogni giorno nuovi sapori" },
        { iconKey: "rocket", title: "Crescita multi-paese", text: "La stessa piattaforma, su misura per ogni nuovo mercato" },
      ],
      valueTitle: "Creare valore per i tuoi prodotti",
      valueSubtitle: "Il nostro slogan riflette il nostro impegno — in ogni paese in cui operiamo",
      valueParagraphs: [
        "Fedele al suo slogan \"Creare valore per i tuoi prodotti\", I-Coffee ha continuato a innovare, introducendo funzionalità come il commercio di macchine da caffè, risorse educative e connessioni potenziate tra fornitori e acquirenti.",
        "L'impatto della piattaforma ha superato i confini della Nigeria. I-Coffee è ora un marketplace multi-paese — portando la stessa crescita, le stesse connessioni e una cultura del caffè fiorente in nuovi mercati come il Togo, con prezzi e pagamenti su misura per ogni valuta locale.",
      ],
      principles: [
        { iconKey: "coffee", title: "La qualità prima di tutto", description: "Ogni prodotto sulla nostra piattaforma rispetta rigorosi standard di qualità, in ogni mercato." },
        { iconKey: "handshake", title: "Costruire connessioni", description: "Uniamo fornitori e acquirenti in un marketplace fluido, ovunque si trovino." },
        { iconKey: "heart", title: "Il successo del cliente", description: "La tua crescita e soddisfazione sono la misura del nostro successo." },
      ],
      closingTitle: "Il viaggio continua",
      closingParagraphs: [
        "Oggi, I-Coffee è un polo multi-paese per il commercio di caffè — attivo in Nigeria e Togo, e in crescita — ma la nostra storia è tutt'altro che conclusa. Continuiamo a innovare, espanderci e creare valore per ogni membro della nostra community.",
        "Che tu sia un fornitore in cerca di crescita, un'azienda alla ricerca di prodotti di qualità, o un appassionato di caffè in cerca di nuovi orizzonti, fai parte della nostra storia — ovunque tu sia nel mondo mentre leggi queste righe.",
      ],
    },
  },

  faq: {
    seo: {
      title: "FAQ | I-Coffee",
      description: "Risposte alle domande più comuni su ordini, spedizioni, pagamenti nella tua valuta locale e altro ancora.",
    },
    content: {
      heroTitle: "Domande frequenti",
      heroSubtitle: "Trova risposte alle domande più comuni su ordini, spedizioni, pagamenti e altro ancora",
      categories: [
        { id: "all", name: "Tutte le domande" },
        { id: "ordering", name: "Ordini" },
        { id: "shipping", name: "Spedizioni" },
        { id: "payment", name: "Pagamento" },
        { id: "returns", name: "Resi" },
        { id: "account", name: "Account" },
      ],
      faqs: [
        { category: "ordering", question: "I-Coffee opera in più di un paese?", answer: "Sì — I-Coffee è una piattaforma multi-paese. Ogni paese ha il proprio sito (ad esempio i-coffee.ng per la Nigeria e i-coffee.tg per il Togo), con prezzi, opzioni di consegna e metodi di pagamento su misura per quel mercato, e contenuti disponibili nelle lingue pertinenti per quel paese." },
        { category: "ordering", question: "Come faccio a effettuare un ordine su I-Coffee?", answer: "Sfoglia i nostri prodotti, aggiungi gli articoli al carrello e procedi al checkout. Puoi ordinare come ospite o creare un account per un checkout più rapido e per tracciare i tuoi ordini." },
        { category: "ordering", question: "Posso modificare o annullare il mio ordine dopo averlo effettuato?", answer: "Gli ordini possono essere modificati o annullati entro 2 ore dall'effettuazione. Contatta subito il nostro servizio clienti tramite la pagina Contattaci del tuo paese." },
        { category: "ordering", question: "Quali metodi di pagamento accettate?", answer: "I metodi di pagamento dipendono dal tuo paese. In Nigeria, i pagamenti vengono elaborati in modo sicuro tramite Paystack — carte, bonifici bancari e USSD, tutti in Naira. In tutti gli altri paesi in cui operiamo, i pagamenti vengono elaborati tramite Stripe, che supporta carte locali e internazionali nella tua valuta locale." },
        { category: "ordering", question: "C'è una quantità minima d'ordine?", answer: "Non esiste una quantità minima d'ordine per i clienti regolari. Tuttavia, gli ordini all'ingrosso possono beneficiare di sconti speciali. Contattaci per i prezzi all'ingrosso." },
        { category: "shipping", question: "In quali zone effettuate le consegne?", answer: "Attualmente consegniamo in Nigeria e Togo, con altri paesi che verranno aggiunti nel tempo. Ogni sito I-Coffee nazionale mostra solo le zone e le opzioni di consegna disponibili in quel mercato — consulta la pagina Politica di spedizione del tuo sito I-Coffee locale per la copertura esatta." },
        { category: "shipping", question: "Quanto tempo richiede la consegna?", answer: "I tempi di consegna variano in base al paese e alla località all'interno di quel paese. Consulta la pagina Politica di spedizione del tuo sito I-Coffee locale per i tempi di consegna esatti nella tua zona." },
        { category: "shipping", question: "Quali sono i costi di spedizione?", answer: "I costi di spedizione variano in base al paese, alla località e al peso dell'ordine, e sono sempre mostrati nella tua valuta locale al momento del checkout. Anche le soglie per la spedizione gratuita variano in base al mercato — consulta la pagina Politica di spedizione del tuo paese per i dettagli esatti." },
        { category: "shipping", question: "Come posso tracciare il mio ordine?", answer: "Dopo la spedizione del tuo ordine, riceverai un numero di tracciamento via email e SMS. Puoi tracciare il tuo ordine in tempo reale dalla tua area account o dalla nostra pagina di tracciamento." },
        { category: "shipping", question: "Qual è il vostro tasso di successo nelle consegne?", answer: "Manteniamo un tasso di consegna riuscita del 97% in Nigeria, il nostro mercato più consolidato, e stiamo costruendo lo stesso standard di affidabilità man mano che ci espandiamo in nuovi paesi." },
        { category: "payment", question: "I miei dati di pagamento sono al sicuro?", answer: "Sì, assolutamente. Tutti i pagamenti vengono elaborati tramite Paystack (Nigeria) o Stripe (tutti gli altri paesi), entrambi con crittografia SSL conforme agli standard del settore e gateway di pagamento sicuri. Non memorizziamo mai i dati completi della tua carta sui nostri server." },
        { category: "payment", question: "Offrite il pagamento alla consegna?", answer: "Il pagamento alla consegna è disponibile in alcune zone di alcuni paesi. Dove disponibile, questa opzione verrà mostrata al checkout per il tuo indirizzo di consegna." },
        { category: "payment", question: "Posso ottenere una fattura per il mio acquisto?", answer: "Sì, una fattura viene generata automaticamente e inviata alla tua email dopo l'acquisto, nella tua valuta locale. Puoi anche scaricare le fatture dalla tua area account." },
        { category: "returns", question: "Qual è la vostra politica di reso?", answer: "Accettiamo resi entro 7 giorni dall'acquisto. I prodotti devono essere nelle condizioni originali, con tutti gli imballaggi e gli accessori. Si applica una commissione di reintegro del 20%, salvo in caso di difetti di fabbricazione. Consulta la nostra pagina Politica di reso per tutti i dettagli." },
        { category: "returns", question: "Come faccio a iniziare un reso?", answer: "Contatta il servizio clienti entro 7 giorni dal ricevimento del tuo ordine, tramite la pagina Contattaci del tuo paese. Fornisci il numero d'ordine e il motivo del reso. Ti invieremo un numero di autorizzazione al reso e le istruzioni necessarie." },
        { category: "returns", question: "Quando riceverò il mio rimborso?", answer: "I rimborsi vengono elaborati entro 5-10 giorni lavorativi dal ricevimento e dalla verifica del prodotto restituito. I rimborsi vengono accreditati sul metodo di pagamento originale, nella valuta originale." },
        { category: "returns", question: "Chi paga la spedizione di reso?", answer: "I clienti sono responsabili dei costi di spedizione del reso, a meno che il reso non sia dovuto a un nostro errore o a un prodotto difettoso. Consigliamo di utilizzare un servizio di spedizione tracciabile." },
        { category: "account", question: "Ho bisogno di un account per fare acquisti?", answer: "No, puoi effettuare il checkout come ospite. Tuttavia, creare un account ti permette di tracciare gli ordini, salvare indirizzi, visualizzare la cronologia degli ordini e usufruire di un checkout più rapido." },
        { category: "account", question: "Come reimposto la mia password?", answer: "Clicca su \"Password dimenticata\" nella pagina di accesso. Inserisci il tuo indirizzo email e ti invieremo un link per reimpostare la password. Segui le istruzioni nell'email per impostarne una nuova." },
        { category: "account", question: "Posso aggiornare il mio indirizzo di consegna?", answer: "Sì, puoi aggiungere, modificare o eliminare indirizzi nelle impostazioni del tuo account. Puoi anche inserire un indirizzo diverso durante il checkout." },
        { category: "account", question: "Come mi iscrivo alla vostra newsletter?", answer: "Inserisci la tua email nel modulo di iscrizione alla newsletter in fondo a qualsiasi pagina. Riceverai offerte esclusive, consigli sul caffè e aggiornamenti sui nuovi prodotti." },
        { category: "ordering", question: "Che tipo di prodotti a base di caffè vendete?", answer: "Offriamo una gamma completa che include chicchi di caffè, capsule, caffè macinato, caffè solubile, macchine da caffè, accessori, sciroppi, macchine per cold brew e persino prodotti di bellezza a tema caffè — oltre 858 prodotti da oltre 65 marchi locali e internazionali, disponibili in ogni paese in cui operiamo." },
        { category: "ordering", question: "Offrite prezzi all'ingrosso?", answer: "Sì! Offriamo prezzi all'ingrosso competitivi per gli ordini di grandi quantità. Contattaci tramite la pagina Contattaci del tuo paese per discutere delle tue esigenze e dei prezzi." },
        { category: "shipping", question: "Posso programmare un orario di consegna?", answer: "Anche se non possiamo garantire orari di consegna specifici, puoi aggiungere istruzioni di consegna nelle note del tuo ordine. Il nostro team farà del suo meglio per venire incontro alle tue preferenze." },
        { category: "payment", question: "Accettate carte di credito internazionali?", answer: "Sì. A seconda del tuo paese, i pagamenti vengono elaborati tramite Paystack (Nigeria) o Stripe (tutti gli altri paesi), entrambi compatibili con le principali carte internazionali." },
      ],
      ctaTitle: "Hai ancora domande?",
      ctaText: "Il nostro team di assistenza clienti è qui per aiutarti",
      ctaPhone: "+2348039827194",
    },
  },

  "return-policy": {
    seo: {
      title: "Politica di reso e rimborso | I-Coffee",
      description: "Condizioni di reso, processo e tempistiche di rimborso di I-Coffee — la stessa politica in ogni paese in cui operiamo.",
    },
    content: {
      heroTitle: "Politica di reso e rimborso",
      heroSubtitle: "La tua soddisfazione è la nostra priorità, in ogni paese in cui operiamo. Consulta la nostra politica di reso per garantirti un'esperienza senza intoppi.",
      supplierNoticeTitle: "Avviso importante per i fornitori",
      supplierNoticeText: "I fornitori registrati sulla piattaforma I-Coffee, in qualsiasi paese, devono assicurarsi di comprendere e rispettare questa politica di rimborso per mantenere un processo di transazione fluido e trasparente con i clienti.",
      returnConditions: [
        { iconKey: "clock", title: "Finestra di reso di 7 giorni", description: "I clienti devono restituire i prodotti entro 7 giorni dalla data di acquisto." },
        { iconKey: "box", title: "Condizioni originali", description: "I prodotti devono essere restituiti nelle loro condizioni originali, non aperti e non utilizzati, con tutta la confezione originale." },
        { iconKey: "shield", title: "Prova d'acquisto", description: "La ricevuta originale o la prova d'acquisto deve essere fornita insieme al reso." },
        { iconKey: "money", title: "Commissione di reintegro", description: "Verrà detratta una commissione di gestione del 20% per unità e i costi di trasporto, salvo in caso di difetti di fabbricazione." },
      ],
      returnProcess: [
        { step: "1", title: "Contatta il servizio clienti", description: "Contatta il nostro team di assistenza entro 7 giorni dall'acquisto tramite la pagina Contattaci del tuo paese." },
        { step: "2", title: "Autorizzazione al reso", description: "Ricevi un numero di autorizzazione al reso e le istruzioni dal nostro team." },
        { step: "3", title: "Imballa il tuo articolo", description: "Imballa con cura il prodotto nelle sue condizioni originali, con tutti gli accessori e la documentazione." },
        { step: "4", title: "Spedisci il prodotto", description: "Invia il pacco all'indirizzo di reso indicato. Conserva il numero di tracciamento." },
        { step: "5", title: "Verifica", description: "Il nostro team verificherà le condizioni del prodotto restituito al ricevimento." },
        { step: "6", title: "Elaborazione del rimborso", description: "Il rimborso verrà emesso dopo la verifica, con la detrazione delle commissioni applicabili, nella valuta di pagamento originale." },
      ],
      refundTimelineText: "I rimborsi verranno emessi dopo la verifica del prodotto restituito e la detrazione delle commissioni applicabili. Il processo di rimborso richiede solitamente 5-10 giorni lavorativi dal ricevimento e dalla verifica del reso. Il rimborso verrà accreditato sul tuo metodo di pagamento originale — tramite Paystack in Nigeria, o Stripe in tutti gli altri paesi in cui operiamo.",
      deductionHandlingFee: "20% del costo del prodotto per unità",
      deductionTransportCost: "Costi di spedizione effettivi",
      deductionException: "Nessuna detrazione per difetti di fabbricazione",
      eligibleForFullRefund: [
        "Difetti di fabbricazione riscontrati alla consegna",
        "Prodotti danneggiati durante la spedizione",
        "Articoli errati spediti dal fornitore",
        "Prodotti significativamente diversi dalla descrizione",
        "Prodotti con problemi di qualità segnalati immediatamente",
      ],
      nonReturnableItems: [
        "Prodotti con sigilli rotti o confezione aperta",
        "Prodotti usati o danneggiati per negligenza del cliente",
        "Prodotti privi di confezione o accessori originali",
        "Prodotti scaduti acquistati consapevolmente",
        "Miscele di caffè personalizzate o su misura",
        "Prodotti oltre la finestra di reso di 7 giorni",
      ],
      additionalInfo: [
        { label: "Prodotti scaduti", text: "I prodotti scaduti non devono mai essere consegnati ai clienti. Se ricevi un prodotto scaduto, contattaci immediatamente tramite la pagina Contattaci del tuo paese per un rimborso completo." },
        { label: "Responsabilità del fornitore", text: "I fornitori sono responsabili della qualità dei prodotti che consegnano. I resi dovuti a errori del fornitore non comporteranno commissioni di gestione per i clienti." },
        { label: "Spedizione di reso", text: "I clienti sono responsabili dei costi di spedizione del reso, a meno che il reso non sia dovuto a un nostro errore o a un difetto del prodotto." },
        { label: "Politica di cambio", text: "Attualmente offriamo solo rimborsi. Se desideri un prodotto diverso, effettua un nuovo ordine dopo aver ricevuto il rimborso." },
      ],
      contactPhone: "+234 800 000 0000",
      contactPhoneHours: "Lun-Ven: 9:00 - 18:00",
      contactEmail: "support@i-coffee.ng",
      contactEmailNote: "Risposta entro 24 ore. Questa è la linea di assistenza della sede centrale di I-Coffee — alcuni paesi dispongono anche di propri recapiti locali sulla pagina Contattaci.",
    },
  },

  "privacy-policy": {
    seo: {
      title: "Informativa sulla privacy | I-Coffee",
      description: "Come I-Coffee raccoglie, utilizza e protegge le tue informazioni, in ogni paese in cui operiamo.",
    },
    content: {
      lastUpdated: "Ultimo aggiornamento: novembre 2025",
      introParagraphs: [
        "In I-Coffee, ci impegniamo a proteggere la tua privacy e a garantire la sicurezza delle tue informazioni personali, in ogni paese in cui I-Coffee opera. Questa Informativa sulla privacy spiega come raccogliamo, utilizziamo, divulghiamo e proteggiamo le tue informazioni quando utilizzi la nostra piattaforma.",
        "Utilizzando I-Coffee — su qualsiasi dei nostri siti nazionali — acconsenti alle pratiche sui dati descritte in questa informativa. Se non sei d'accordo con questa informativa, ti preghiamo di non utilizzare la nostra piattaforma.",
      ],
      dataTypes: [
        { iconKey: "userShield", title: "Informazioni personali", items: ["Nome e recapiti", "Indirizzo email", "Numero di telefono", "Indirizzo di consegna", "Informazioni aziendali (se applicabile)"] },
        { iconKey: "database", title: "Dati delle transazioni", items: ["Cronologia degli ordini", "Informazioni di pagamento", "Preferenze di acquisto", "Registro delle comunicazioni", "Attività dell'account"] },
        { iconKey: "cookie", title: "Dati tecnici", items: ["Indirizzo IP", "Tipo e versione del browser", "Informazioni sul dispositivo", "Cookie e dati di utilizzo", "Dati di localizzazione"] },
      ],
      useCards: [
        { title: "Elaborazione degli ordini", text: "Elaborare ed evadere i tuoi ordini, gestire i pagamenti (tramite Paystack o Stripe, a seconda del tuo paese) e fornire assistenza clienti.", color: "green" },
        { title: "Comunicazione", text: "Inviare conferme d'ordine, aggiornamenti sulla spedizione e rispondere alle tue richieste.", color: "blue" },
        { title: "Miglioramento della piattaforma", text: "Analizzare i modelli di utilizzo per migliorare i nostri servizi, le funzionalità e l'esperienza utente in ogni mercato in cui operiamo.", color: "purple" },
        { title: "Marketing", text: "Inviare offerte promozionali, newsletter e aggiornamenti (con il tuo consenso).", color: "orange" },
        { title: "Sicurezza e prevenzione delle frodi", text: "Rilevare e prevenire attività fraudolente, proteggere da minacce alla sicurezza.", color: "red" },
        { title: "Conformità legale", text: "Rispettare gli obblighi legali e far rispettare i nostri termini e politiche.", color: "indigo" },
      ],
      securityIntro: "Adottiamo misure di sicurezza conformi agli standard del settore per proteggere le tue informazioni personali, ovunque tu sia:",
      securityMeasures: [
        "Crittografia SSL per la trasmissione dei dati",
        "Gateway di pagamento sicuri (Paystack e Stripe)",
        "Controlli di sicurezza regolari",
        "Controlli di accesso e autenticazione",
        "Sistemi di backup e ripristino dei dati",
        "Formazione dei dipendenti sulla protezione dei dati",
      ],
      securityDisclaimer: "Sebbene ci impegniamo a proteggere le tue informazioni, nessun metodo di trasmissione via internet è sicuro al 100%. Non possiamo garantire una sicurezza assoluta.",
      sharingSections: [
        { title: "Con i fornitori", text: "Condividiamo le informazioni necessarie con i fornitori del tuo paese per evadere i tuoi ordini, incluso l'indirizzo di consegna e i recapiti." },
        { title: "Con i fornitori di servizi", text: "Collaboriamo con fornitori di servizi terzi per l'elaborazione dei pagamenti (Paystack, Stripe), la consegna e l'analisi dei dati. Questi fornitori sono contrattualmente obbligati a proteggere le tue informazioni." },
        { title: "Per motivi legali", text: "Potremmo divulgare informazioni quando richiesto dalla legge, per proteggere i nostri diritti, o in risposta a procedimenti legali." },
      ],
      sharingNotice: "Non vendiamo le tue informazioni personali a terzi.",
      yourRights: [
        { title: "Accesso", description: "Richiedere una copia dei tuoi dati personali" },
        { title: "Rettifica", description: "Aggiornare o correggere informazioni inesatte" },
        { title: "Cancellazione", description: "Richiedere la cancellazione dei tuoi dati personali" },
        { title: "Portabilità", description: "Ricevere i tuoi dati in un formato strutturato" },
        { title: "Opposizione", description: "Opporti al trattamento dei tuoi dati" },
        { title: "Revoca del consenso", description: "Revocare il consenso al trattamento dei dati" },
      ],
      rightsContactEmail: "customercare@i-coffee.ng",
      cookiesIntro: "Utilizziamo cookie e tecnologie di tracciamento simili per migliorare la tua esperienza sulla nostra piattaforma. I cookie sono piccoli file memorizzati sul tuo dispositivo che ci aiutano a:",
      cookiesList: ["Ricordare le tue preferenze e impostazioni", "Mantenerti connesso al tuo account", "Analizzare come utilizzi la nostra piattaforma", "Fornire contenuti e consigli personalizzati", "Migliorare le prestazioni e la sicurezza della piattaforma"],
      cookiesOutro: "Puoi controllare i cookie tramite le impostazioni del tuo browser. Tuttavia, disabilitare i cookie potrebbe compromettere la tua capacità di utilizzare alcune funzionalità della nostra piattaforma.",
      retentionIntro: "Conserviamo le tue informazioni personali per il tempo necessario a:",
      retentionList: ["Realizzare le finalità descritte in questa Informativa sulla privacy", "Rispettare gli obblighi legali", "Risolvere controversie e far rispettare gli accordi", "Mantenere i registri aziendali"],
      retentionOutro: "Quando non avremo più bisogno delle tue informazioni, le elimineremo o le renderemo anonime in modo sicuro, in conformità con le leggi applicabili.",
      childrenText: "La nostra piattaforma non è destinata a minori di 18 anni. Non raccogliamo consapevolmente informazioni personali relative a minori. Se ritieni che abbiamo raccolto informazioni relative a un minore, contattaci immediatamente.",
      transferParagraphs: [
        "Le tue informazioni potrebbero essere trasferite ed elaborate in paesi diversi dal tuo paese di residenza — inclusa la Nigeria, dove ha sede I-Coffee, e qualsiasi altro paese in cui I-Coffee opera, come il Togo. Garantiamo che siano in atto misure di salvaguardia adeguate per proteggere le tue informazioni in conformità con questa Informativa sulla privacy.",
        "Utilizzando la nostra piattaforma, acconsenti al trasferimento delle tue informazioni in Nigeria e negli altri paesi in cui operiamo.",
      ],
      updatesText: "Potremmo aggiornare periodicamente questa Informativa sulla privacy. Le modifiche saranno pubblicate su questa pagina con una data di \"Ultimo aggiornamento\" aggiornata. Ti invitiamo a consultare periodicamente questa informativa. L'uso continuato della nostra piattaforma dopo le modifiche costituisce accettazione dell'informativa aggiornata.",
      contactEmail: "customercare@i-coffee.ng",
      contactPhone: "+234 805 242 3935",
      contactPhoneHref: "tel:+2348052423935",
      contactAddress: "3 Kaffi Street, Alausa, Ikeja, Lagos, Nigeria (sede centrale di I-Coffee)",
    },
  },
};

// ─────────────────────────────────────────────────────────────────────────

async function upsertTranslation(slug, language, { content, seo }) {
  const doc = await SitePageModel.findOne({ slug, countryCode: "GLOBAL" }).select("_id");
  if (!doc) {
    console.warn(`  ! Skipped ${slug} → ${language}: no GLOBAL SitePage found (run updateMultiCountryPages.js first)`);
    return;
  }
  await TranslationModel.findOneAndUpdate(
    { entityType: "page", entityId: doc._id, language },
    {
      fields: { content, seo },
      autoTranslated: false, // "Manual" in the admin UI — protects this from being overwritten by a future bulk auto-translate run
      translatedAt: new Date(),
      engine: "llm-manual",
      sourceLanguage: "en",
    },
    { upsert: true, new: true }
  );
  console.log(`  + wrote ${slug} → ${language}`);
}

async function main() {
  await connectDB();

  console.log("→ Writing French translations …");
  for (const [slug, data] of Object.entries(FR_PAGES)) {
    await upsertTranslation(slug, "fr", data);
  }

  console.log("→ Writing Italian translations …");
  for (const [slug, data] of Object.entries(IT_PAGES)) {
    await upsertTranslation(slug, "it", data);
  }

  console.log("✅ Done. Review these in Admin → Site Pages → (page) → FR/IT tab.");
  console.log("   They're marked 'Manual', so the auto-translate button won't touch them again.");
  process.exit(0);
}

main().catch((err) => {
  console.error("❌ Failed:", err);
  process.exit(1);
});
