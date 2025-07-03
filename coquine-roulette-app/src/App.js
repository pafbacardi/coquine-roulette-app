import React, { useState, useEffect, useRef, useCallback } from 'react';
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously, signInWithCustomToken, onAuthStateChanged } from 'firebase/auth';
import { getFirestore, doc, getDoc, setDoc, collection, onSnapshot } from 'firebase/firestore';

// Déclaration des variables globales fournies par l'environnement Canvas
// Ces variables sont injectées au moment de l'exécution et ne doivent pas être modifiées ici.
const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';
const firebaseConfig = typeof __firebase_config !== 'undefined' ? JSON.parse(__firebase_config) : {};
const initialAuthToken = typeof __initial_auth_token !== 'undefined' ? initialAuthToken : null; // Correction: initialAuthToken était mal assigné

const App = () => {
    // États pour gérer les joueurs, les actions, les zones du corps et le résultat du tirage
    const [players, setPlayers] = useState([]); // Liste des joueurs
    const [newPlayerName, setNewPlayerName] = useState(''); // Nom du nouveau joueur à ajouter
    const [newPlayerSex, setNewPlayerSex] = useState('homme'); // Sexe du nouveau joueur
    const [newPlayerAcceptSameSex, setNewPlayerAcceptSameSex] = useState(true); // Accepte le même sexe
    // result stocke maintenant les objets joueur complets pour player1 et player2
    const [result, setResult] = useState({ player1: null, action: '', bodyPart: '', player2: null, countdownTime: 0, isJokerChallenge: false, jokerChallengeText: '' }); // Résultat du tirage
    const [isSpinning, setIsSpinning] = useState(false); // Indique si les rouleaux tournent
    const [showInstructions, setShowInstructions] = useState(true); // Afficher les instructions au début
    const [showErrorModal, setShowErrorModal] = useState(false); // Afficher le modal d'erreur
    const [errorMessage, setErrorMessage] = useState(''); // Message d'erreur

    // Ordre des niveaux et leur mapping aux types d'actions/zones du corps
    const levelOrder = [
        { id: 'level1', name: 'Niveau 1 (Doux)', actionType: 'doux', bodyPartType: 'doux' },
        { id: 'level2', name: 'Niveau 2 (Moyen)', actionType: 'moyen', bodyPartType: 'doux' },
        { id: 'level3', name: 'Niveau 3 (Intermédiaire)', actionType: 'moyen', bodyPartType: 'moyen' },
        { id: 'level4', name: 'Niveau 4 (Intense)', actionType: 'intense', bodyPartType: 'moyen' },
        { id: 'level5', name: 'Niveau 5 (Ultime)', actionType: 'intense', bodyPartType: 'intense' },
        { id: 'level6', name: 'Niveau 6 (Fusion Ultime)', actionType: 'fusion', bodyPartType: 'intense' } // Nouveau niveau
    ];
    const [currentLevelIndex, setCurrentLevelIndex] = useState(0); // Index du niveau actuel dans levelOrder

    // État pour suivre les participations de chaque joueur par niveau (basé sur l'ID du niveau)
    const [playerParticipationCounts, setPlayerParticipationCounts] = useState({});
    // États pour le modal de progression de niveau
    const [showLevelUpModal, setShowLevelUpModal] = useState(false);
    const [levelUpMessage, setLevelUpMessage] = useState('');
    const [levelUpTitle, setLevelUpTitle] = useState('');

    // Nouveaux états pour le compte à rebours
    const [remainingTime, setRemainingTime] = useState(0); // Temps restant du compte à rebours
    const [isCountingDown, setIsCountingDown] = useState(false); // Indique si le compte à rebours est actif
    const countdownIntervalRef = useRef(null); // Référence pour l'intervalle du compte à rebours
    const [isAudioContextReady, setIsAudioContextReady] = useState(false); // Indique si le contexte audio est prêt

    // Nouvel état pour les défis du niveau 6
    const [level6Challenges, setLevel6Challenges] = useState(null); // Stocke les binômes/trios et leurs défis
    const [soloPlayersForLevel6, setSoloPlayersForLevel6] = useState([]); // Stocke les joueurs non groupés

    // États pour Firebase
    const [db, setDb] = useState(null);
    const [auth, setAuth] = useState(null);
    const [userId, setUserId] = useState(null);
    const [isAuthReady, setIsAuthReady] = useState(false); // Pour s'assurer que l'authentification est prête avant Firestore

    // États pour les données chargées de Firestore (initialisées avec les valeurs par défaut)
    const [actionsData, setActionsData] = useState({
        doux: ["touche", "caresse", "chatouille", "effleure", "susurre à", "respire sur", "souffle sur", "embrasse tendrement", "hume"],
        moyen: ["embrasse", "frotte", "masse", "glisse sur", "lèche doucement", "presse", "mordille"],
        intense: ["lèche", "suce", "pince", "embrasse passionnément", "caresse sensuellement"],
        fusion: ["La Cuillère", "Le Lotus", "Le Papillon", "Le Missionnaire", "La Déesse", "Le Cavalier", "Le 69", "Le Pont", "L'Arc", "Le Yab-Yum"]
    });
    const [bodyPartsData, setBodyPartsData] = useState({
        doux: { neutral: ["le cou", "l'oreille", "le lobe d'oreille", "la nuque", "l'épaule", "le bras", "la main", "la paume", "les doigts", "le poignet", "le front", "la tempe", "la joue", "la paupière", "le mollet", "la cheville", "le pied", "les orteils", "les cheveux"], homme: [], femme: [] },
        moyen: { neutral: ["la poitrine", "le ventre", "le nombril", "le bas du dos", "la cuisse", "le genou", "l'aisselle", "la hanche", "le coccyx", "la colonne vertébrale", "les lèvres", "la langue", "la mâchoire", "les cheveux"], homme: [], femme: [] },
        intense: { neutral: ["la fesse", "l'intérieur de la cuisse", "l'entrejambe", "le périnée", "le pli de l'aine", "le téton", "les cheveux"], homme: ["le pénis", "le gland", "le scrotum"], femme: ["le clitoris", "les grandes lèvres", "les petites lèvres", "le vagin"] }
    });

    // Nouvelle structure pour les défis Joker (templates)
    const [jokerChallengesTemplates, setJokerChallengesTemplates] = useState({
        level1: [
            { id: 'joker1-1', template: "**Le regard soutenu :** {player1} et {player2} doivent se regarder dans les yeux sans rire pendant 30 secondes.", playersNeeded: 2, accessories: [] },
            { id: 'joker1-2', template: "**La chaîne de caresses :** Tout le groupe se met en cercle et chaque joueur caresse le dos de la personne devant lui pendant 1 minute.", playersNeeded: 'all', accessories: [] },
            { id: 'joker1-3', template: "**Le mime sensuel :** {player1} doit mimer une action sensuelle (ex: danser lascivement, manger un fruit avec passion) et les autres devinent.", playersNeeded: 1, accessories: [] },
            { id: 'joker1-4', template: "**Le compliment intime :** Chaque joueur fait un compliment sincère et intime à la personne à sa droite.", playersNeeded: 'all', accessories: [] },
            { id: 'joker1-5', template: "**La pose suggestive :** Tout le groupe doit prendre une photo de groupe dans une pose suggestive avec un appareil photo/vidéo. (Accessoire : **appareil photo/vidéo**)", playersNeeded: 'all', accessories: ['appareil photo/vidéo'] },
            { id: 'joker1-6', template: "**La confession sonore :** {player1} doit enregistrer un message vocal intime ou une déclaration coquine pour le groupe. (Accessoire : **téléphone/enregistreur**)", playersNeeded: 1, accessories: ['téléphone/enregistreur'] },
            { id: 'joker1-7', template: "**Le défi du parfum :** {player1} doit deviner le parfum de {player2} en le sentant sur son cou.", playersNeeded: 2, accessories: [] },
            { id: 'joker1-8', template: "**Le dessin corporel :** {player1} dessine quelque chose de simple sur le bras de {player2} avec son doigt.", playersNeeded: 2, accessories: [] },
            { id: 'joker1-9', template: "**Le secret chuchoté :** {player1} chuchote un secret coquin à l'oreille de {player2}, qui doit ensuite le chuchoter à {player3}.", playersNeeded: 3, accessories: [] },
            { id: 'joker1-10', template: "**La danse du regard :** {player1} et {player2} dansent ensemble en se fixant dans les yeux, sans toucher.", playersNeeded: 2, accessories: [] },
            { id: 'joker1-11', template: "**Le défi de la \"première impression coquine\" :** Chaque joueur doit dire la première chose coquine qui lui vient à l'esprit en pensant à la personne en face de lui/elle.", playersNeeded: 'all', accessories: [] },
            { id: 'joker1-12', template: "**La \"vérité ou boisson\" légère :** Le groupe pose des questions légères sur les préférences coquines (ex: \"Je n'ai jamais embrassé quelqu'un en public\"). Ceux qui ont fait l'action boivent.", playersNeeded: 'all', accessories: [] }
        ],
        level2: [
            { id: 'joker2-1', template: "**Le massage des pieds :** {player1} masse les pieds de {player2} pendant 1 minute.", playersNeeded: 2, accessories: [] },
            { id: 'joker2-2', template: "**La dégustation à l'aveugle :** {player1} fait goûter un aliment/boisson à l'aveugle à {player2} de manière suggestive.", playersNeeded: 2, accessories: [] },
            { id: 'joker2-3', template: "**Le blindfold challenge (non intime) :** {player1} a les yeux bandés et doit identifier {player2} en le/la touchant uniquement avec ses lèvres ou sa langue sur une partie du corps non intime (bras, épaule, cou). (Accessoire : **bandeau**)", playersNeeded: 2, accessories: ['bandeau'] },
            { id: 'joker2-4', template: "**La caresse prolongée :** {player1} caresse lentement le bras, le cou ou le dos de {player2} pendant 30 secondes.", playersNeeded: 2, accessories: [] },
            { id: 'joker2-5', template: "**Le souffle chaud :** {player1} souffle doucement sur la nuque ou l'oreille de {player2} pendant 15 secondes.", playersNeeded: 2, accessories: [] },
            { id: 'joker2-6', template: "**Le défi du contact visuel prolongé :** Tout le groupe se regarde intensément, un par un, pendant 10 secondes chacun.", playersNeeded: 'all', accessories: [] },
            { id: 'joker2-7', template: "**Le \"Je n'ai jamais...\" coquin (niveau 2) :** Le groupe joue à \"Je n'ai jamais...\" avec des affirmations plus suggestives. Ceux qui ont fait l'action doivent boire.", playersNeeded: 'all', accessories: [] },
            { id: 'joker2-8', template: "**Le toucher mystère :** {player1} touche une partie du corps de {player2} (par-dessus les vêtements) et {player2} doit deviner où.", playersNeeded: 2, accessories: [] },
            { id: 'joker2-9', template: "**La lecture sensuelle :** {player1} lit un court passage d'un texte sensuel ou érotique à voix haute pour le groupe.", playersNeeded: 1, accessories: [] },
            { id: 'joker2-10', template: "**Le défi du \"Hot or Not\" :** Le groupe désigne un joueur, et les autres doivent dire une chose \"hot\" et une chose \"not\" sur lui/elle (toujours dans le respect).", playersNeeded: 'all', accessories: [] },
            { id: 'joker2-11', template: "**Le défi des mains liées :** {player1} et {player2} ont une main attachée ensemble et doivent accomplir une tâche simple (ex: se servir à boire) en utilisant uniquement leurs mains libres et leur corps. (Accessoire : **foulard/cordelette**)", playersNeeded: 2, accessories: ['foulard/cordelette'] },
            { id: 'joker2-12', template: "**Le \"Truth or Dare\" doux :** Le groupe pose des questions de \"vérité\" ou des \"gages\" plus osés, mais toujours verbalement ou avec des actions non-contact direct.", playersNeeded: 'all', accessories: [] }
        ],
        level3: [
            { id: 'joker3-1', template: "**Le baiser surprise :** {player1} doit donner un baiser surprise à {player2} (sur la joue, le cou, ou la nuque).", playersNeeded: 2, accessories: [] },
            { id: 'joker3-2', template: "**Le frôlement intime (vêtements) :** {player1} doit frôler avec ses lèvres ou sa langue une zone érogène (cou, oreille, téton, entrejambe par-dessus les vêtements) de {player2} pendant 10 secondes.", playersNeeded: 2, accessories: [] },
            { id: 'joker3-3', template: "**Le jeu du Glaçon (corps) :** Un glaçon est passé de corps en corps (sur la peau, non intime) jusqu'à ce qu'il fonde. (Accessoire : **glaçon**)", playersNeeded: 'all', accessories: ['glaçon'] },
            { id: 'joker3-4', template: "**Le déshabillage partiel :** {player1} doit aider {player2} à retirer un vêtement (chaussette, pull, t-shirt) de manière suggestive.", playersNeeded: 2, accessories: [] },
            { id: 'joker3-5', template: "**Le défi de la respiration :** {player1} et {player2} se placent face à face, très proches, et doivent synchroniser leur respiration pendant 1 minute.", playersNeeded: 2, accessories: [] },
            { id: 'joker3-6', template: "**Le massage des mains sensuel :** {player1} masse les mains de {player2} de manière très sensuelle et prolongée.", playersNeeded: 2, accessories: [] },
            { id: 'joker3-7', template: "**Le défi du \"regard qui déshabille\" :** {player1} et {player2} se regardent intensément, et chacun doit décrire ce qu'il/elle aimerait faire à l'autre sans le toucher.", playersNeeded: 2, accessories: [] },
            { id: 'joker3-8', template: "**La danse du corps à corps :** {player1} et {player2} dansent collé-serré pendant une chanson lente.", playersNeeded: 2, accessories: [] },
            { id: 'joker3-9', template: "**Le défi du \"soupir\" :** {player1} doit faire soupirer {player2} par des caresses légères sur des zones non intimes (bras, cou, dos).", playersNeeded: 2, accessories: [] },
            { id: 'joker3-10', template: "**Le défi du \"Body Shot\" (non-alcoolisé) :** {player1} doit boire une boisson non alcoolisée directement sur une partie du corps (cou, ventre, cuisse...) de {player2}. (Accessoire : **shot/boisson**)", playersNeeded: 2, accessories: ['shot/boisson'] },
            { id: 'joker3-11', template: "**Le \"strip-poker\" léger :** Le groupe joue au poker (ou autre jeu de cartes simple), et chaque fois qu'un joueur perd une manche, il doit retirer un vêtement (ex: une chaussette, une montre).", playersNeeded: 'all', accessories: [] },
            { id: 'joker3-12', template: "**La \"chaîne de baisers\" :** Chaque joueur embrasse la personne à sa droite sur une partie du corps choisie par le groupe (cou, épaule, main).", playersNeeded: 'all', accessories: [] }
        ],
        level4: [
            { id: 'joker4-1', template: "**Le baiser sensuel prolongé :** {player1} et {player2} doivent s'embrasser passionnément (avec la langue) pendant 30 secondes.", playersNeeded: 2, accessories: [] },
            { id: 'joker4-2', template: "**La danse érotique :** {player1} doit faire une danse érotique pour le reste du groupe pendant une minute.", playersNeeded: 1, accessories: [] },
            { id: 'joker4-3', template: "**Le déshabillage en duo (sans les mains) :** {player1} et {player2} doivent s'aider mutuellement à retirer leurs vêtements (jusqu'à la nudité complète si le niveau le permet, ou en sous-vêtements) en 30 secondes, sans utiliser leurs mains.", playersNeeded: 2, accessories: [] },
            { id: 'joker4-4', template: "**Le défi du \"Strip-Tease à l'aveugle\" :** {player1} a les yeux bandés et doit faire un strip-tease jusqu'à la nudité complète (si le niveau le permet) ou en sous-vêtements pour le groupe. (Accessoire : **bandeau**)", playersNeeded: 1, accessories: ['bandeau'] },
            { id: 'joker4-5', template: "**Le défi du sex toy partagé (sur vêtements) :** {player1} doit utiliser un sex toy (imaginaire ou réel) sur {player2} pendant 1 minute, en se concentrant sur les zones érogènes par-dessus les vêtements. (Accessoire : **sex toy (optionnel)**)", playersNeeded: 2, accessories: ['sex toy (optionnel)'] },
            { id: 'joker4-6', template: "**Le massage à l'huile (zones plus intimes, sur vêtements) :** {player1} doit masser {player2} avec de l'huile (imaginaire ou réelle) sur les fesses ou l'intérieur des cuisses par-dessus les vêtements pendant 2 minutes. (Accessoire : **huile de massage (optionnel)**)", playersNeeded: 2, accessories: ['huile de massage (optionnel)'] },
            { id: 'joker4-7', template: "**Le défi du \"lèche-doigt\" :** {player1} lèche le doigt de {player2} de manière suggestive.", playersNeeded: 2, accessories: [] },
            { id: 'joker4-8', template: "**Le \"strip-poker\" avancé :** Le groupe joue au poker (ou autre jeu de cartes simple), et chaque fois qu'un joueur perd une manche, il doit retirer un vêtement plus significatif (ex: chemise, pantalon) jusqu'au niveau de nudité autorisé.", playersNeeded: 'all', accessories: [] },
            { id: 'joker4-9', template: "**Le défi du \"chuchotement intime\" :** {player1} chuchote un fantasme intime à l'oreille de {player2}, qui doit le répéter à voix haute.", playersNeeded: 2, accessories: [] },
            { id: 'joker4-10', template: "**Le Body Shot (alcoolisé ou non) :** {player1} doit boire un shot (alcoolisé ou non) directement sur une partie du corps (cou, ventre, cuisse...) de {player2}. (Accessoire : **shot/boisson**)", playersNeeded: 2, accessories: ['shot/boisson'] },
            { id: 'joker4-11', template: "**Le blindfold challenge (toucher intime sur vêtements) :** {player1} a les yeux bandés et doit identifier {player2} en le/la touchant uniquement avec ses lèvres ou sa langue sur une partie du corps intime (poitrine, fesses, entrejambe) par-dessus les vêtements. (Accessoire : **bandeau**)", playersNeeded: 2, accessories: ['bandeau'] },
            { id: 'joker4-12', template: "**Le défi de la \"sculpture corporelle\" :** {player1} utilise ses mains pour \"sculpter\" le corps de {player2} par-dessus les vêtements, en créant une pose suggestive.", playersNeeded: 2, accessories: [] }
        ],
        level5: [
            { id: 'joker5-1', template: "**Le Body Shot Ultime :** {player1} doit boire un shot (alcoolisé ou non) directement sur une zone érogène (ex: téton, nombril, entrejambe) de {player2}. (Accessoire : **shot/boisson**)", playersNeeded: 2, accessories: ['shot/boisson'] },
            { id: 'joker5-2', template: "**Le baiser profond et prolongé :** {player1} et {player2} doivent s'embrasser passionnément, en explorant la bouche de l'autre, pendant au moins 1 minute.", playersNeeded: 2, accessories: [] },
            { id: 'joker5-3', template: "**La danse érotique complète :** {player1} doit faire une danse érotique complète pour le reste du groupe.", playersNeeded: 1, accessories: [] },
            { id: 'joker5-4', template: "**Le frôlement intime (peau) :** {player1} doit frôler avec ses lèvres ou sa langue une zone érogène (cou, oreille, téton, entrejambe) de {player2} pendant 10 secondes, directement sur la peau. (Accessoire : **bandeau**)", playersNeeded: 2, accessories: [] },
            { id: 'joker5-5', template: "**La confession ultime :** Chaque joueur doit révéler le fantasme le plus audacieux qu'il n'a jamais réalisé, en détaillant.", playersNeeded: 'all', accessories: [] },
            { id: 'joker5-6', template: "**Le jeu du Glaçon (bouche à bouche ou corps à corps intime) :** Un glaçon est passé de bouche en bouche (ou de corps en corps sur des zones intimes) jusqu'à ce qu'il fonde, en utilisant uniquement la langue ou les lèvres. (Accessoire : **glaçon**)", playersNeeded: 'all', accessories: ['glaçon'] },
            { id: 'joker5-7', template: "**La question sans filtre (extrême) :** Chaque joueur pose une question à un autre joueur, et la réponse doit être absolument honnête et sans filtre, quelle que soit l'intimité ou la gêne potentielle de la question.", playersNeeded: 'all', accessories: [] },
            { id: 'joker5-8', template: "**Le massage mutuel nu :** {player1} et {player2} doivent se faire un massage mutuel, nus, pendant 2 minutes. (Accessoire : **huile de massage (optionnel)**)", playersNeeded: 2, accessories: ['huile de massage (optionnel)'] },
            { id: 'joker5-9', template: "**La dégustation du corps :** {player1} doit lécher une partie du corps de {player2} (ex: cou, épaule, ventre, fesse) et deviner une saveur (sel, sucre, etc.) qui y aurait été déposée.", playersNeeded: 2, accessories: [] },
            { id: 'joker5-10', template: "**Le blindfold challenge (toucher intime sur peau) :** {player1} a les yeux bandés et doit identifier {player2} en le/la touchant uniquement avec ses lèvres ou sa langue sur une partie du corps intime (poitrine, fesses, entrejambe) directement sur la peau. (Accessoire : **bandeau**)", playersNeeded: 2, accessories: ['bandeau'] },
            { id: 'joker5-11', template: "**Le défi du \"toucher intime\" :** {player1} doit toucher une zone intime (poitrine, fesses, entrejambe) de {player2} pendant 10 secondes.", playersNeeded: 2, accessories: [] },
            { id: 'joker5-12', template: "**Le défi du \"bain de bouche partagé\" :** {player1} prend une gorgée d'une boisson et la passe de bouche à bouche à {player2}.", playersNeeded: 2, accessories: [] },
            { id: 'joker5-13', template: "**La douche sensuelle en groupe :** {player1} doit doucher sensuellement {player2} (nus, si le niveau le permet), tandis que le reste du groupe assiste à ce moment. L'objectif est de créer une ambiance érotique et intime. (Accessoires : **douche/eau, savon/gel douche (optionnel)**)", playersNeeded: 2, accessories: ['douche/eau', 'savon/gel douche (optionnel)'] },
            { id: 'joker5-14', template: "**Le défi du \"Body Painting Intime\" :** {player1} utilise de la peinture corporelle comestible (ou non) pour peindre une zone intime de {player2}, que {player3} doit ensuite lécher. (Accessoire : **peinture corporelle comestible (optionnel)**)", playersNeeded: 3, accessories: ['peinture corporelle comestible (optionnel)'] },
            { id: 'joker5-15', template: "**Le défi de la \"chaîne de baisers intimes\" :** Chaque joueur embrasse la personne à sa droite sur une zone intime choisie par le groupe (ex: téton, entrejambe).", playersNeeded: 'all', accessories: [] },
            { id: 'joker5-16', template: "**Le Cercle de Souffles Intimes :** Tout le groupe s'allonge en cercle, la tête positionnée au niveau des hanches ou des cuisses du voisin. Chaque participant doit se concentrer sur la respiration de la personne dont la tête est près de son entrejambe, en cherchant à synchroniser les souffles et à ressentir l'intimité de cette proximité.", playersNeeded: 'all', accessories: [] }
        ]
    });

    // Mode Admin
    const [isAdminMode, setIsAdminMode] = useState(false);
    const [adminPassword, setAdminPassword] = useState('');
    const ADMIN_SECRET_PASSWORD = 'admin'; // Mot de passe simple pour la démo

    // États pour l'édition des données en mode admin (maintenant des objets structurés)
    const [editableActions, setEditableActions] = useState({});
    const [editableBodyParts, setEditableBodyParts] = useState({});
    const [editableJokerChallenges, setEditableJokerChallenges] = useState({});


    // --- Initialisation Firebase et chargement des données ---
    useEffect(() => {
        if (!firebaseConfig.projectId) {
            console.error("Firebase config is missing. Cannot initialize Firebase.");
            setErrorMessage("Erreur de configuration Firebase. Veuillez vérifier la console.");
            setShowErrorModal(true);
            return;
        }

        try {
            const app = initializeApp(firebaseConfig);
            const authInstance = getAuth(app);
            const dbInstance = getFirestore(app);
            setAuth(authInstance);
            setDb(dbInstance);

            const unsubscribe = onAuthStateChanged(authInstance, async (user) => {
                if (user) {
                    setUserId(user.uid);
                } else {
                    // Sign in anonymously if no user is logged in
                    try {
                        if (initialAuthToken) {
                            await signInWithCustomToken(authInstance, initialAuthToken);
                        } else {
                            await signInAnonymously(authInstance);
                        }
                        setUserId(authInstance.currentUser?.uid || crypto.randomUUID()); // Fallback for anonymous
                    } catch (error) {
                        console.error("Firebase Auth Error:", error);
                        setErrorMessage(`Erreur d'authentification Firebase: ${error.message}`);
                        setShowErrorModal(true);
                    }
                }
                setIsAuthReady(true); // Auth state is now known
            });

            return () => unsubscribe();
        } catch (error) {
            console.error("Failed to initialize Firebase:", error);
            setErrorMessage(`Échec de l'initialisation de Firebase: ${error.message}`);
            setShowErrorModal(true);
        }
    }, []);

    // Charger les données de Firestore une fois que Firebase est prêt
    useEffect(() => {
        if (!db || !isAuthReady) return;

        const loadData = async () => {
            try {
                // Charger les actions
                const actionsDocRef = doc(db, `artifacts/${appId}/public/data/gameData/actions`);
                const actionsSnap = await getDoc(actionsDocRef);
                if (actionsSnap.exists()) {
                    const data = actionsSnap.data();
                    setActionsData(data);
                    setEditableActions(data); // Initialiser l'état éditable
                } else {
                    // Si le document n'existe pas, initialiser avec les valeurs par défaut et sauvegarder
                    await setDoc(actionsDocRef, actionsData);
                    setEditableActions(actionsData);
                }

                // Charger les zones du corps
                const bodyPartsDocRef = doc(db, `artifacts/${appId}/public/data/gameData/bodyParts`);
                const bodyPartsSnap = await getDoc(bodyPartsDocRef);
                if (bodyPartsSnap.exists()) {
                    const data = bodyPartsSnap.data();
                    setBodyPartsData(data);
                    setEditableBodyParts(data); // Initialiser l'état éditable
                } else {
                    await setDoc(bodyPartsDocRef, bodyPartsData);
                    setEditableBodyParts(bodyPartsData);
                }

                // Charger les défis Joker
                const jokerChallengesDocRef = doc(db, `artifacts/${appId}/public/data/gameData/jokerChallenges`);
                const jokerChallengesSnap = await getDoc(jokerChallengesDocRef);
                if (jokerChallengesSnap.exists()) {
                    const data = jokerChallengesSnap.data();
                    setJokerChallengesTemplates(data);
                    setEditableJokerChallenges(data);
                } else {
                    await setDoc(jokerChallengesDocRef, jokerChallengesTemplates);
                    setEditableJokerChallenges(jokerChallengesTemplates);
                }

            } catch (error) {
                console.error("Error loading game data from Firestore:", error);
                setErrorMessage(`Erreur lors du chargement des données du jeu: ${error.message}`);
                setShowErrorModal(true);
            }
        };

        loadData();

        // Écouter les changements en temps réel (optionnel pour les listes de jeu si elles ne changent pas souvent)
        // Pour les listes de jeu, un chargement unique au démarrage est souvent suffisant.
        // Si tu veux des mises à jour en temps réel pour l'admin, tu peux ajouter onSnapshot ici.
    }, [db, isAuthReady]); // Dépend de db et isAuthReady

    // --- Fonctions de sauvegarde Firestore ---
    const saveActionsData = async () => {
        if (!db || !userId) {
            setErrorMessage("Firestore non initialisé ou utilisateur non authentifié.");
            setShowErrorModal(true);
            return;
        }
        try {
            await setDoc(doc(db, `artifacts/${appId}/public/data/gameData/actions`), editableActions);
            setActionsData(editableActions); // Mettre à jour l'état local après sauvegarde
            setErrorMessage('Actions sauvegardées avec succès !'); // Remplacé alert()
            setShowErrorModal(true); // Afficher le modal de succès/info
        } catch (error) {
            console.error("Error saving actions data:", error);
            setErrorMessage(`Erreur lors de la sauvegarde des actions: ${error.message}`);
            setShowErrorModal(true);
        }
    };

    const saveBodyPartsData = async () => {
        if (!db || !userId) {
            setErrorMessage("Firestore non initialisé ou utilisateur non authentifié.");
            setShowErrorModal(true);
            return;
        }
        try {
            await setDoc(doc(db, `artifacts/${appId}/public/data/gameData/bodyParts`), editableBodyParts);
            setBodyPartsData(editableBodyParts); // Mettre à jour l'état local après sauvegarde
            setErrorMessage('Zones du corps sauvegardées avec succès !'); // Remplacé alert()
            setShowErrorModal(true); // Afficher le modal de succès/info
        } catch (error) {
            console.error("Error saving body parts data:", error);
            setErrorMessage(`Erreur lors de la sauvegarde des zones du corps: ${error.message}`);
            setShowErrorModal(true);
        }
    };

    const saveJokerChallengesData = async () => {
        if (!db || !userId) {
            setErrorMessage("Firestore non initialisé ou utilisateur non authentifié.");
            setShowErrorModal(true);
            return;
        }
        try {
            // Nettoyer les templates vides avant de sauvegarder
            const cleanedChallenges = {};
            for (const level in editableJokerChallenges) {
                cleanedChallenges[level] = editableJokerChallenges[level].filter(
                    challenge => challenge.template.trim() !== ''
                );
            }

            await setDoc(doc(db, `artifacts/${appId}/public/data/gameData/jokerChallenges`), cleanedChallenges);
            setJokerChallengesTemplates(cleanedChallenges); // Mettre à jour l'état local
            setErrorMessage('Défis Joker sauvegardés avec succès !'); // Remplacé alert()
            setShowErrorModal(true); // Afficher le modal de succès/info
        } catch (error) {
            console.error("Error saving Joker challenges data:", error);
            setErrorMessage(`Erreur lors de la sauvegarde des défis Joker: ${error.message}`);
            setShowErrorModal(true);
        }
    };


    // Function to get colored player name HTML string for dynamic text generation
    const getColoredName = (player) => {
        const colorClass = player.sex === 'homme' ? 'text-blue-600' : 'text-pink-600';
        return `<span class="font-bold ${colorClass}">${player.name}</span>`;
    };

    // Helper to get a random player, excluding a specific one if needed
    const getRandomPlayer = (excludePlayer = null) => {
        const availablePlayers = players.filter(p => p.name !== excludePlayer?.name);
        if (availablePlayers.length === 0) return null;
        return availablePlayers[Math.floor(Math.random() * availablePlayers.length)];
    };

    // Helper to get two random, compatible players
    const getTwoCompatiblePlayers = () => {
        if (players.length < 2) return [null, null];
        let p1, p2, attempts = 0;
        const maxAttempts = 100;
        do {
            p1 = players[Math.floor(Math.random() * players.length)];
            p2 = players[Math.floor(Math.random() * players.length)];
            attempts++;
        } while ((p1.name === p2.name || !checkCompatibility(p1, p2)) && attempts < maxAttempts);
        return [p1, p2];
    };

    // Helper to get three random, compatible players
    const getThreeCompatiblePlayers = () => {
        if (players.length < 3) return [null, null, null];
        let p1, p2, p3, attempts = 0;
        const maxAttempts = 100;
        do {
            p1 = players[Math.floor(Math.random() * players.length)];
            p2 = players[Math.floor(Math.random() * players.length)];
            p3 = players[Math.floor(Math.random() * players.length)];
            attempts++;
        } while ((p1.name === p2.name || p1.name === p3.name || p2.name === p3.name || !checkCompatibility(p1, p2) || !checkCompatibility(p1, p3) || !checkCompatibility(p2, p3)) && attempts < maxAttempts);
        return [p1, p2, p3];
    };


    // Fonction pour générer le texte du défi Joker à partir du template
    const generateJokerChallengeText = (challengeTemplate) => {
        let text = challengeTemplate.template;
        const needed = challengeTemplate.playersNeeded;

        let selectedPlayers = [];
        if (needed === 1) {
            selectedPlayers.push(getRandomPlayer());
        } else if (needed === 2) {
            selectedPlayers = getTwoCompatiblePlayers();
        } else if (needed === 3) {
            selectedPlayers = getThreeCompatiblePlayers();
        } else if (needed === 'all') {
            selectedPlayers = players; // Use all players
        }

        if (selectedPlayers.some(p => p === null)) {
            return "Pas assez de joueurs pour ce défi Joker.";
        }

        selectedPlayers.forEach((player, index) => {
            text = text.replace(`{player${index + 1}}`, getColoredName(player));
        });

        // Gérer les accessoires
        if (challengeTemplate.accessories && challengeTemplate.accessories.length > 0) {
            // Le template doit déjà inclure la mention des accessoires pour qu'elle soit visible
            // Ex: "Le défi X. (Accessoire : **bandeau**)"
            // Si le template n'inclut pas, on pourrait ajouter ici, mais c'est mieux si le template le gère.
        }

        return text;
    };


    // Fonction pour obtenir les défis Joker pour un niveau donné
    const getJokerChallengesForLevel = (levelId) => {
        // Retourne les templates chargés depuis l'état (qui vient de Firestore)
        return jokerChallengesTemplates[levelId] || [];
    };


    // Références pour les éléments des rouleaux afin de simuler l'animation
    const player1Ref = useRef(null);
    const actionRef = useRef(null);
    const bodyPartRef = useRef(null);
    const player2Ref = useRef(null);
    const countdownRef = useRef(null); // Nouvelle référence pour le rouleau du temps

    // Options pour le rouleau du temps (5s à 60s par pas de 5s)
    const countdownOptions = Array.from({ length: 12 }, (_, i) => `${(i + 1) * 5}s`);

    // Composant de rouleau réutilisable
    const Reel = ({ reelRef, isSpinning, finalValue, type, sex = null }) => {
        const reelItems = useRef([]);
        const [displayValue, setDisplayValue] = useState('');

        // Populate reelItems based on type and sex
        useEffect(() => {
            let options = [];
            if (type === 'player') {
                options = players.map(p => p.name);
            } else if (type === 'action') {
                options = actionsData[levelOrder[currentLevelIndex].actionType] || [];
            } else if (type === 'bodyPart') {
                const currentBodyPartType = levelOrder[currentLevelIndex].bodyPartType;
                options = [
                    ...(bodyPartsData[currentBodyPartType]?.neutral || []),
                    ...(sex === 'homme' ? bodyPartsData[currentBodyPartType]?.homme || [] : []),
                    ...(sex === 'femme' ? bodyPartsData[currentBodyPartType]?.femme || [] : [])
                ];
            } else if (type === 'time') {
                options = countdownOptions;
            } else if (type === 'joker') {
                options = ['J', 'O', 'K', 'E', 'R', '!']; // For Joker display
            }

            // Duplicate options for a smooth infinite scroll effect
            reelItems.current = [...options, ...options, ...options];
        }, [players, currentLevelIndex, type, sex, actionsData, bodyPartsData]); // Re-run if players, level, actionsData or bodyPartsData change

        useEffect(() => {
            let spinInterval;
            if (isSpinning) {
                // Start spinning animation
                spinInterval = setInterval(() => {
                    setDisplayValue(reelItems.current[Math.floor(Math.random() * reelItems.current.length)]);
                }, 50); // Fast change for spinning effect
            } else {
                // Stop spinning and show final value
                clearInterval(spinInterval);
                setDisplayValue(finalValue);
            }
            return () => clearInterval(spinInterval);
        }, [isSpinning, finalValue, reelItems]);


        const textColorClass = (type === 'player' && finalValue) ?
            (players.find(p => p.name === finalValue)?.sex === 'homme' ? 'text-blue-600' : 'text-pink-600') :
            'text-purple-800';

        return (
            <div className="relative bg-purple-50 p-2 rounded-lg shadow-inner border border-purple-200 flex flex-col items-center justify-center min-h-[80px] overflow-hidden">
                <div ref={reelRef} className="h-12 flex items-center justify-center w-full">
                    <p className={`text-xl font-bold ${textColorClass} transition-colors duration-300 ease-in-out`}>
                        {isSpinning ? (type === 'joker' ? displayValue : displayValue) : (finalValue || '???')}
                    </p>
                </div>
            </div>
        );
    };


    // Effet pour gérer l'animation de "spin"
    useEffect(() => {
        // L'animation de spin ne se produit que pour les niveaux 1 à 5
        if (isSpinning && currentLevelIndex < 5) {
            const reelSpinDuration = 1500; // Durée de rotation de chaque rouleau avant de s'arrêter
            const stopDelayIncrement = 300; // Délai entre l'arrêt de chaque rouleau

            const stopReel = (ref, finalValue, delay) => {
                setTimeout(() => {
                    // The Reel component will pick up the finalValue from props
                    // and stop its internal spinning animation.
                }, reelSpinDuration + delay);
            };

            if (result.isJokerChallenge) {
                const jokerLetters = ['J', 'O', 'K', 'E', 'R'];
                stopReel(player1Ref, jokerLetters[0], 0 * stopDelayIncrement);
                stopReel(actionRef, jokerLetters[1], 1 * stopDelayIncrement);
                stopReel(bodyPartRef, jokerLetters[2], 2 * stopDelayIncrement);
                stopReel(player2Ref, jokerLetters[3], 3 * stopDelayIncrement);
                stopReel(countdownRef, jokerLetters[4], 4 * stopDelayIncrement);
            } else {
                stopReel(player1Ref, result.player1?.name, 0 * stopDelayIncrement);
                stopReel(actionRef, result.action, 1 * stopDelayIncrement);
                stopReel(bodyPartRef, result.bodyPart, 2 * stopDelayIncrement);
                stopReel(player2Ref, result.player2?.name, 3 * stopDelayIncrement);
                stopReel(countdownRef, result.countdownTime ? `${result.countdownTime}s` : '???', 4 * stopDelayIncrement);
            }

            // Arrêter l'état de "spinning" après que tous les rouleaux se soient arrêtés
            setTimeout(() => {
                if (isSpinning) {
                    setIsSpinning(false);
                }
            }, reelSpinDuration + 4 * stopDelayIncrement + 100);

        }
    }, [isSpinning, result, players, currentLevelIndex]);


    // Fonction pour démarrer le contexte audio (nécessite une interaction utilisateur)
    const startAudioContext = () => {
        if (typeof Tone !== 'undefined' && Tone.context.state !== 'running') {
            Tone.start().then(() => {
                console.log("Tone.js AudioContext démarré.");
                setIsAudioContextReady(true);
            }).catch(e => console.error("Échec du démarrage de Tone.js AudioContext:", e));
        } else if (typeof Tone !== 'undefined' && Tone.context.state === 'running') {
            setIsAudioContextReady(true);
        }
    };

    // Fonction pour jouer un son de buzzer (utilisant Tone.js)
    const playBuzzer = () => {
        if (isAudioContextReady && typeof Tone !== 'undefined') {
            const synth = new Tone.MembraneSynth().toDestination();
            synth.triggerAttackRelease("C2", "8n"); // Un son court et grave
        } else {
            console.warn("Contexte audio non prêt ou Tone.js non chargé. Impossible de jouer le buzzer.");
        }
    };

    // Fonction pour démarrer le compte à rebours
    const startCountdown = () => {
        if (result.countdownTime === 0 || isCountingDown) return;

        startAudioContext(); // S'assurer que le contexte audio est démarré

        setIsCountingDown(true);
        setRemainingTime(result.countdownTime);

        countdownIntervalRef.current = setInterval(() => {
            setRemainingTime(prevTime => {
                if (prevTime <= 1) {
                    clearInterval(countdownIntervalRef.current);
                    setIsCountingDown(false);
                    playBuzzer();
                    return 0;
                }
                return prevTime - 1;
            });
        }, 1000);
    };

    // Nettoyage de l'intervalle du compte à rebours lors du démontage du composant
    useEffect(() => {
        return () => {
            if (countdownIntervalRef.current) {
                clearInterval(countdownIntervalRef.current);
            }
        };
    }, []);


    // Fonction pour ajouter un joueur
    const addPlayer = () => {
        if (newPlayerName.trim() === '') {
            setErrorMessage("Le nom du joueur ne peut pas être vide !");
            setShowErrorModal(true);
            return;
        }
        if (players.length >= 10) {
            setErrorMessage("Vous ne pouvez pas ajouter plus de 10 joueurs.");
            setShowErrorModal(true);
            return;
        }

        // Vérifier si le nom du joueur existe déjà
        if (players.some(player => player.name.toLowerCase() === newPlayerName.trim().toLowerCase())) {
            setErrorMessage(`Le joueur "${newPlayerName.trim()}" existe déjà.`);
            setShowErrorModal(true);
            return;
        }

        setPlayers(prevPlayers => {
            const updatedPlayers = [...prevPlayers, { name: newPlayerName.trim(), sex: newPlayerSex, acceptSameSex: newPlayerAcceptSameSex }];
            // Réinitialiser les compteurs de participation pour tous les joueurs existants et le nouveau
            const newCounts = {};
            updatedPlayers.forEach(player => {
                newCounts[player.name] = {};
                levelOrder.forEach(level => {
                    newCounts[player.name][level.id] = 0;
                });
            });
            setPlayerParticipationCounts(newCounts);
            setCurrentLevelIndex(0); // Réinitialiser le niveau au premier (Doux)
            setResult(prev => ({ ...prev, countdownTime: 0, isJokerChallenge: false, jokerChallengeText: '' })); // Réinitialiser le temps du compte à rebours
            setRemainingTime(0); // Réinitialiser le temps restant
            setIsCountingDown(false); // Arrêter le compte à rebours
            setLevel6Challenges(null); // Réinitialiser les défis du niveau 6
            setSoloPlayersForLevel6([]); // Réinitialiser les joueurs solos
            return updatedPlayers;
        });
        setNewPlayerName('');
        setNewPlayerSex('homme'); // Réinitialiser le sexe par défaut
        setNewPlayerAcceptSameSex(true); // Réinitialiser la préférence par défaut
    };

    // Fonction pour supprimer un joueur
    const removePlayer = (index) => {
        setPlayers(prevPlayers => {
            const updatedPlayers = prevPlayers.filter((_, i) => i !== index);
            // Réinitialiser les compteurs de participation pour les joueurs restants
            const newCounts = {};
            updatedPlayers.forEach(player => {
                newCounts[player.name] = {};
                levelOrder.forEach(level => {
                    newCounts[player.name][level.id] = 0;
                });
            });
            setPlayerParticipationCounts(newCounts);
            setCurrentLevelIndex(0); // Réinitialiser le niveau au premier (Doux)
            setResult(prev => ({ ...prev, countdownTime: 0, isJokerChallenge: false, jokerChallengeText: '' })); // Réinitialiser le temps du compte à rebours
            setRemainingTime(0); // Réinitialiser le temps restant
            setIsCountingDown(false); // Arrêter le compte à rebours
            setLevel6Challenges(null); // Réinitialiser les défis du niveau 6
            setSoloPlayersForLevel6([]); // Réinitialiser les joueurs solos
            return updatedPlayers;
        });
    };

    // Fonction pour ajouter automatiquement 10 joueurs
    const addTenPlayersAutomatically = () => {
        const maleNames = ["Alexandre", "Benjamin", "Charles", "Damien", "Étienne", "François", "Guillaume", "Hugo", "Ivan", "Julien"];
        const femaleNames = ["Alice", "Béatrice", "Camille", "Delphine", "Émilie", "Fanny", "Gabrielle", "Hélène", "Inès", "Jeanne"];
        const autoPlayers = [];

        // Mélanger les listes de noms pour plus de variété à chaque génération
        const shuffledMaleNames = [...maleNames].sort(() => 0.5 - Math.random());
        const shuffledFemaleNames = [...femaleNames].sort(() => 0.5 - Math.random());

        for (let i = 0; i < 10; i++) {
            let name;
            let sex;
            // Alterner les sexes
            if (i % 2 === 0) {
                sex = 'homme';
                name = shuffledMaleNames[Math.floor(i / 2)]; // Utilise la moitié des noms masculins
            } else {
                sex = 'femme';
                name = shuffledFemaleNames[Math.floor(i / 2)]; // Utilise la moitié des noms féminins
            }

            // Alterner la préférence pour le même sexe
            const acceptSameSex = i % 4 < 2; // Ex: true, true, false, false, true, true...

            autoPlayers.push({ name, sex, acceptSameSex });
        }

        setPlayers(autoPlayers);
        // Réinitialiser les compteurs de participation pour les nouveaux joueurs
        const newCounts = {};
        autoPlayers.forEach(player => {
            newCounts[player.name] = {};
            levelOrder.forEach(level => {
                newCounts[player.name][level.id] = 0;
            });
        });
        setPlayerParticipationCounts(newCounts);
        setCurrentLevelIndex(0); // Réinitialiser le niveau au premier (Doux)
        setResult(prev => ({ ...prev, countdownTime: 0, isJokerChallenge: false, jokerChallengeText: '' })); // Réinitialiser le temps du compte à rebours
        setRemainingTime(0); // Réinitialiser le temps restant
        setIsCountingDown(false); // Arrêter le compte à rebours
        setLevel6Challenges(null); // Réinitialiser les défis du niveau 6
        setSoloPlayersForLevel6([]); // Réinitialiser les joueurs solos
        return autoPlayers;
    };

    // Function to check if player1 and player2 are compatible for interaction (e.g., undressing, pairing)
    const checkCompatibility = (p1, p2) => {
        if (p1.name === p2.name) return false; // Cannot interact with self
        if (p1.sex === p2.sex) { // Same sex interaction
            return p1.acceptSameSex && p2.acceptSameSex;
        }
        // Different sex interaction is always allowed
        return true;
    };

    // Helper function to form Level 6 groups respecting preferences
    const formLevel6Groups = (currentPlayersToGroup) => {
        if (currentPlayersToGroup.length < 2) {
            setErrorMessage("Il faut au moins 2 joueurs pour former des groupes au Niveau 6.");
            setShowErrorModal(true);
            return { groups: [], soloPlayers: [] };
        }

        const shuffledPlayers = [...currentPlayersToGroup].sort(() => 0.5 - Math.random());
        const groups = [];
        const remainingPlayers = [...shuffledPlayers];
        const soloPlayers = [];

        const getRandomFusionAction = () => actionsData.fusion[Math.floor(Math.random() * actionsData.fusion.length)];
        const getRandomIntenseBodyPart = () => {
            const allIntenseParts = [
                ...(bodyPartsData.intense?.neutral || []),
                ...(bodyPartsData.intense?.homme || []),
                ...(bodyPartsData.intense?.femme || [])
            ];
            return allIntenseParts[Math.floor(Math.random() * allIntenseParts.length)];
        };


        // Try to form pairs (prioritizing mixed-sex)
        let attempts = 0;
        const maxPairingAttempts = remainingPlayers.length * remainingPlayers.length;

        while (remainingPlayers.length >= 2 && attempts < maxPairingAttempts) {
            let p1Index = -1;
            let p2Index = -1;

            // Find a mixed-sex pair first
            for (let i = 0; i < remainingPlayers.length; i++) {
                for (let j = i + 1; j < remainingPlayers.length; j++) {
                    if (remainingPlayers[i].sex !== remainingPlayers[j].sex && checkCompatibility(remainingPlayers[i], remainingPlayers[j])) {
                        p1Index = i;
                        p2Index = j;
                        break;
                    }
                }
                if (p1Index !== -1) break;
            }

            if (p1Index !== -1) { // Mixed-sex pair found
                const selectedBodyPart = getRandomIntenseBodyPart();
                groups.push({ players: [remainingPlayers[p1Index], remainingPlayers[p2Index]], challenge: `${getRandomFusionAction()}. Le défi se termine par un baiser ${selectedBodyPart}.` });
                remainingPlayers.splice(p2Index, 1);
                remainingPlayers.splice(p1Index, 1);
                attempts = 0;
            } else {
                // If no mixed-sex pair, try to find a same-sex pair (if allowed)
                p1Index = -1;
                p2Index = -1;
                for (let i = 0; i < remainingPlayers.length; i++) {
                    for (let j = i + 1; j < remainingPlayers.length; j++) {
                        if (checkCompatibility(remainingPlayers[i], remainingPlayers[j])) {
                            p1Index = i;
                            p2Index = j;
                            break;
                        }
                    }
                    if (p1Index !== -1) break;
                }

                if (p1Index !== -1) { // Same-sex pair found
                    const selectedBodyPart = getRandomIntenseBodyPart();
                    groups.push({ players: [remainingPlayers[p1Index], remainingPlayers[p2Index]], challenge: `${getRandomFusionAction()}. Le défi se termine par un baiser ${selectedBodyPart}.` });
                    remainingPlayers.splice(p2Index, 1);
                    remainingPlayers.splice(p1Index, 1);
                    attempts = 0;
                } else {
                    attempts++;
                }
            }
        }

        // Handle remaining players (should be 0, 1, 2, or 3)
        if (remainingPlayers.length === 3) {
            const trio = remainingPlayers;
            let trioValid = true;
            // Check all 3 internal pairs for same-sex compatibility
            if (!checkCompatibility(trio[0], trio[1]) || !checkCompatibility(trio[0], trio[2]) || !checkCompatibility(trio[1], trio[2])) {
                trioValid = false;
            }

            if (trioValid) {
                const selectedBodyPart = getRandomIntenseBodyPart();
                groups.push({ players: trio, challenge: `${getRandomFusionAction()}. Le défi se termine par un baiser ${selectedBodyPart}.` });
                remainingPlayers.length = 0;
            } else {
                trio.forEach(p => soloPlayers.push(p));
                remainingPlayers.length = 0;
            }
        }
        
        remainingPlayers.forEach(p => soloPlayers.push(p));

        return { groups, soloPlayers };
    };


    // Helper function to generate undressing messages for level transitions
    const generateUndressingMessages = (playersList, actionVerb, targetAdverb) => {
        if (playersList.length === 0) {
            return "Il n'y a pas de joueurs pour se déshabiller !";
        }

        const messages = [];
        const targetsToUndress = [...playersList]; // Players who need to be undressed
        const undressers = [...playersList]; // Players who can undress others

        // Assign undressers to targets
        const assignments = new Map(); // Map: targetPlayerName -> undresserPlayerObject

        // Iterate through each target to find an undresser
        for (let i = 0; i < targetsToUndress.length; i++) {
            const target = targetsToUndress[i];
            let foundAssignment = false;

            // Try to find an undresser for this target
            // Prioritize undressers who haven't undressed anyone yet, then anyone compatible
            const shuffledUndressers = [...undressers].sort(() => 0.5 - Math.random());

            for (const undresserCandidate of shuffledUndressers) {
                // An undresser cannot undress themselves
                if (undresserCandidate.name === target.name) {
                    continue;
                }

                // Check compatibility
                if (checkCompatibility(undresserCandidate, target)) {
                    assignments.set(target.name, undresserCandidate);
                    foundAssignment = true;
                    break;
                }
            }

            if (!foundAssignment) {
                setErrorMessage(`Impossible de trouver une personne compatible pour déshabiller ${target.name}. Veuillez ajuster les préférences des joueurs.`);
                setShowErrorModal(true);
                return null; // Return null to indicate failure
            }
        }

        // Generate messages based on assignments
        for (const player of playersList) { // Iterate through original list for consistent order
            const undresser = assignments.get(player.name);
            if (undresser) {
                messages.push(`${getColoredName(undresser)} ${actionVerb} ${targetAdverb} ${getColoredName(player)}.`);
            }
        }

        return messages.join('<br/>');
    };


    // Fonction pour gérer le changement de niveau manuel
    const handleLevelChange = (event) => {
        const newIndex = parseInt(event.target.value, 10);
        const oldIndex = currentLevelIndex;

        setResult({ player1: null, action: '', bodyPart: '', player2: null, countdownTime: 0, isJokerChallenge: false, jokerChallengeText: '' });
        setRemainingTime(0);
        setIsCountingDown(false);
        if (countdownIntervalRef.current) {
            clearInterval(countdownIntervalRef.current);
        }
        setLevel6Challenges(null);
        setSoloPlayersForLevel6([]);

        if (newIndex === 5) {
            if (players.length < 2) {
                setErrorMessage("Il faut au moins 2 joueurs pour générer les défis du Niveau 6.");
                setShowErrorModal(true);
                setCurrentLevelIndex(oldIndex);
                return;
            }
            const groupingResult = formLevel6Groups(players);
            // If grouping failed (error modal already shown), revert level
            if (groupingResult === null) {
                setCurrentLevelIndex(oldIndex);
                return;
            }
            setLevel6Challenges(groupingResult.groups);
            setSoloPlayersForLevel6(groupingResult.soloPlayers);

            setResult(prev => ({ ...prev, countdownTime: (Math.floor(Math.random() * 12) + 1) * 5 }));
        }

        setCurrentLevelIndex(newIndex);

        const newCounts = {};
        players.forEach(player => {
            newCounts[player.name] = {};
            levelOrder.forEach(level => {
                newCounts[player.name][level.id] = 0;
            });
        });
        setPlayerParticipationCounts(newCounts);
    };


    // Fonction pour lancer le tirage
    const spinWheel = () => {
        if (players.length < 2) {
            setErrorMessage("Il faut au moins 2 joueurs pour lancer le jeu !");
            setShowErrorModal(true);
            return;
        }

        setRemainingTime(0);
        setIsCountingDown(false);
        if (countdownIntervalRef.current) {
            clearInterval(countdownIntervalRef.current);
        }

        startAudioContext();

        // Determine if it's a Joker challenge (25% chance) for levels 1-5
        const isJoker = currentLevelIndex < 5 && Math.random() < 0.25; // 25% chance

        if (isJoker) {
            setIsSpinning(true); // Still show a brief spin for the Joker reel
            // Set the main reels to 'JOKER!' or empty during spin
            setResult({ player1: null, action: '', bodyPart: null, player2: null, countdownTime: 0, isJokerChallenge: true, jokerChallengeText: '' });

            // Select a random Joker challenge based on current level
            const currentLevelJokerChallenges = getJokerChallengesForLevel(`level${currentLevelIndex + 1}`);
            if (!currentLevelJokerChallenges || currentLevelJokerChallenges.length === 0) {
                setErrorMessage("Aucun défi Joker disponible pour ce niveau.");
                setShowErrorModal(true);
                setIsSpinning(false);
                return;
            }
            const selectedJokerChallengeDef = currentLevelJokerChallenges[Math.floor(Math.random() * currentLevelJokerChallenges.length)];
            const generatedJokerText = generateJokerChallengeText(selectedJokerChallengeDef);

            // Simulate a brief spin for the Joker result
            setTimeout(() => {
                setResult(prev => ({
                    ...prev,
                    isJokerChallenge: true,
                    jokerChallengeText: generatedJokerText,
                    countdownTime: (Math.floor(Math.random() * 12) + 1) * 5 // Joker challenges can also have a time
                }));
                // setIsSpinning(false); // This will be set by the useEffect
            }, 1500); // Shorter spin duration for Joker

        } else if (currentLevelIndex < 5) { // Original logic for levels 1-5
            setIsSpinning(true);

            const currentLevel = levelOrder[currentLevelIndex];
            const currentActions = actionsData[currentLevel.actionType];
            const currentBodyPartsNeutral = bodyPartsData[currentLevel.bodyPartType].neutral;
            const currentBodyPartsHomme = bodyPartsData[currentLevel.bodyPartType].homme;
            const currentBodyPartsFemme = bodyPartsData[currentLevel.bodyPartType].femme;

            if (!currentActions || currentActions.length === 0) {
                setErrorMessage(`Aucune action disponible pour le niveau d'intensité "${currentLevel.name}".`);
                setShowErrorModal(true);
                setIsSpinning(false);
                return;
            }

            let p1Obj, p2Obj, act, bp;
            let isValidCombination = false;
            let attempts = 0;
            const maxAttempts = 100;

            do {
                p1Obj = players[Math.floor(Math.random() * players.length)];
                p2Obj = players[Math.floor(Math.random() * players.length)];

                if (p1Obj.name === p2Obj.name) { attempts++; continue; }
                if (!checkCompatibility(p1Obj, p2Obj)) { attempts++; continue; } // Use checkCompatibility for pairing

                act = currentActions[Math.floor(Math.random() * currentActions.length)];

                let availableBodyParts = [...currentBodyPartsNeutral];
                if (p2Obj.sex === 'homme') { availableBodyParts = availableBodyParts.concat(currentBodyPartsHomme); }
                else if (p2Obj.sex === 'femme') { availableBodyParts = availableBodyParts.concat(currentBodyPartsFemme); }

                if (availableBodyParts.length === 0) { attempts++; continue; }

                bp = availableBodyParts[Math.floor(Math.random() * availableBodyParts.length)];
                isValidCombination = true;

            } while (!isValidCombination && attempts < maxAttempts);

            if (!isValidCombination) {
                setErrorMessage("Impossible de trouver une combinaison valide avec les joueurs et préférences actuels. Essayez de modifier les joueurs ou les préférences.");
                setShowErrorModal(true);
                setIsSpinning(false);
                return;
            }

            const randomTime = (Math.floor(Math.random() * 12) + 1) * 5;
            let nextResult = { player1: p1Obj, action: act, bodyPart: bp, player2: p2Obj, countdownTime: randomTime, isJokerChallenge: false, jokerChallengeText: '' };


            // Vérification de la montée de niveau pour les niveaux 1-5
            setPlayerParticipationCounts(prevCounts => {
                const newCounts = { ...prevCounts };
                const currentLevelId = levelOrder[currentLevelIndex].id; // Use currentLevelIndex to get the ID

                if (!newCounts[p1Obj.name]) { newCounts[p1Obj.name] = {}; levelOrder.forEach(level => newCounts[p1Obj.name][level.id] = 0); }
                if (!newCounts[p2Obj.name]) { newCounts[p2Obj.name] = {}; levelOrder.forEach(level => newCounts[p2Obj.name][level.id] = 0); }

                newCounts[p1Obj.name][currentLevelId]++;
                newCounts[p2Obj.name][currentLevelId]++;

                let shouldAdvance = false;
                for (const player of players) {
                    if (newCounts[player.name] && newCounts[player.name][currentLevelId] >= 5) {
                        shouldAdvance = true;
                        break;
                    }
                }

                if (shouldAdvance) {
                    const nextLevelIndex = currentLevelIndex + 1;
                    const nextLevel = levelOrder[nextLevelIndex];

                    // Clear the result immediately so the reels don't display the outcome of this spin
                    setResult({ player1: null, action: '', bodyPart: null, player2: null, countdownTime: 0, isJokerChallenge: false, jokerChallengeText: '' });
                    setIsSpinning(false); // Stop the spinning animation immediately

                    let title = '';
                    let message = '';
                    let showModal = false; // Nouvelle variable pour contrôler l'affichage du modal

                    if (nextLevelIndex === 5) { // Transition vers le Niveau 6
                        const groupingResult = formLevel6Groups(players);
                        // If grouping failed, do not advance level and show error
                        if (groupingResult === null) {
                            // Error modal already shown by formLevel6Groups
                            return prevCounts; // Do not update counts or level
                        }
                        setLevel6Challenges(groupingResult.groups);
                        setSoloPlayersForLevel6(groupingResult.soloPlayers);

                        title = "Niveau 5 Terminé : Fusion Ultime !";
                        message = "Incroyable ! Le niveau 5 est terminé ! Préparez-vous pour des défis en duo/trio. Chaque groupe devra s'adonner à une action intime jusqu'à ce que vous atteigniez un état de profonde intimité. Laissez libre cours à votre connexion ! 🔥";
                        showModal = true;
                        // Set a random time for the Level 6 challenge, which will be displayed after the modal
                        setResult(prev => ({ ...prev, countdownTime: (Math.floor(Math.random() * 12) + 1) * 5 }));

                    } else if (currentLevelId === 'level2') { // Passage du Niveau 2 au Niveau 3 (Sous-vêtements)
                        title = "Niveau 2 Terminé : En sous-vêtements !";
                        const undressingMessages = generateUndressingMessages(players, 'déshabille', 'en sous-vêtement');
                        if (undressingMessages === null) {
                            // Error modal already shown by generateUndressingMessages
                            return prevCounts; // Do not update counts or level
                        }
                        message = `Félicitations, le niveau 2 est terminé ! Il est temps de passer au niveau 3.<br/><br/>${undressingMessages}<br/><br/>Tout le monde doit maintenant être en sous-vêtements. 😉`;
                        showModal = true;
                    } else if (currentLevelId === 'level4') { // Passage du Niveau 4 au Niveau 5 (Déshabillage complet)
                        title = "Niveau 4 Terminé : Complètement nus !";
                        const undressingMessages = generateUndressingMessages(players, 'déshabille', 'complètement');
                        if (undressingMessages === null) {
                            // Error modal already shown by generateUndressingMessages
                            return prevCounts; // Do not update counts or level
                        }
                        message = `Bravo, le niveau 4 est terminé ! Préparez-vous pour le niveau 5.<br/><br/>${undressingMessages}<br/><br/>Tout le monde doit maintenant être complètement nu ! 😈`;
                        showModal = true;
                    }
                    // Pour les niveaux 1 et 3, showModal reste false, donc le modal ne s'affiche pas.

                    if (showModal) {
                        setLevelUpTitle(title);
                        setLevelUpMessage(message);
                        setShowLevelUpModal(true);
                    }

                    // Reset participation counts for the current level
                    for (const player of players) {
                        if (newCounts[player.name]) {
                            newCounts[player.name][currentLevelId] = 0;
                        }
                    }
                    setCurrentLevelIndex(nextLevelIndex);
                    return newCounts;
                } else {
                    // If no level-up, set the result for the current spin
                    setResult(nextResult);
                    return newCounts;
                }
            });

        } else if (currentLevelIndex === 5) { // Logic for Level 6 (already at Level 6)
            // If already at Level 6, we just generate a new time for existing challenges
            const randomTime = (Math.floor(Math.random() * 12) + 1) * 5;
            setResult(prev => ({ ...prev, countdownTime: randomTime, isJokerChallenge: false })); // Ensure isJokerChallenge is false for Level 6
            setIsSpinning(false);
        }
    };

    // Function to change the current Joker challenge
    const changeJokerChallenge = () => {
        if (isSpinning || !result.isJokerChallenge) return; // Only allow changing if a Joker challenge is displayed and not spinning

        // Stop any active countdown
        if (countdownIntervalRef.current) {
            clearInterval(countdownIntervalRef.current);
            setIsCountingDown(false);
            setRemainingTime(0);
        }

        const currentLevelJokerChallenges = getJokerChallengesForLevel(`level${currentLevelIndex + 1}`);
        if (!currentLevelJokerChallenges || currentLevelJokerChallenges.length === 0) {
            setErrorMessage("Aucun autre défi Joker disponible pour ce niveau.");
            setShowErrorModal(true);
            return;
        }

        // Select a new random Joker challenge
        let newSelectedJokerChallengeDef;
        let newGeneratedJokerText;
        let attempts = 0;
        const maxAttempts = 100;

        // Try to get a different challenge than the current one
        do {
            newSelectedJokerChallengeDef = currentLevelJokerChallenges[Math.floor(Math.random() * currentLevelJokerChallenges.length)];
            newGeneratedJokerText = generateJokerChallengeText(newSelectedJokerChallengeDef);
            attempts++;
        } while (newGeneratedJokerText === result.jokerChallengeText && attempts < maxAttempts);

        // If after many attempts, we still get the same one (e.g., only one challenge available), just use it.
        if (attempts >= maxAttempts && newGeneratedJokerText === result.jokerChallengeText && currentLevelJokerChallenges.length > 1) {
             // Fallback: if stuck on the same, pick a random one again, even if it's the same.
             newSelectedJokerChallengeDef = currentLevelJokerChallenges[Math.floor(Math.random() * currentLevelJokerChallenges.length)];
             newGeneratedJokerText = generateJokerChallengeText(newSelectedJokerChallengeDef);
        }


        setResult(prev => ({
            ...prev,
            jokerChallengeText: newGeneratedJokerText,
            countdownTime: (Math.floor(Math.random() * 12) + 1) * 5 // Generate new random time
        }));
    };


    // Calcul de la hauteur de remplissage pour la barre de tension
    const tensionFillHeight = `${((currentLevelIndex + 1) / levelOrder.length) * 100}%`;

    // Définir les classes de gradient de fond en fonction du niveau actuel
    const backgroundGradients = [
        'from-blue-100 via-blue-200 to-purple-200', // Niveau 1 (Doux)
        'from-purple-200 via-pink-200 to-rose-300', // Niveau 2 (Moyen)
        'from-pink-300 via-purple-300 to-indigo-400', // Niveau 3 (Intermédiaire)
        'from-red-400 via-pink-500 to-purple-500', // Niveau 4 (Intense)
        'from-red-600 via-purple-700 to-pink-700',  // Niveau 5 (Ultime)
        'from-purple-700 via-red-800 to-pink-800'   // Niveau 6 (Fusion Ultime) - Couleurs très intenses
    ];

    const currentBackgroundClass = backgroundGradients[currentLevelIndex];

    return (
        <div className={`min-h-screen bg-gradient-to-br ${currentBackgroundClass} flex flex-col items-center justify-center p-4 font-inter text-gray-800 pb-16 transition-all duration-1000 ease-in-out`}>
            <meta name="viewport" content="width=device-width, initial-scale=1.0" />
            <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&display=swap" rel="stylesheet" />
            {/* Tone.js pour les sons */}
            <script src="https://cdnjs.cloudflare.com/ajax/libs/tone/14.8.49/Tone.min.js"></script>

            {/* Styles pour l'animation de rebond */}
            <style>
                {`
                @keyframes spinReel {
                    0% { transform: translateY(0); }
                    100% { transform: translateY(-100%); } /* Adjust based on content height */
                }

                .reel-item-container {
                    height: 80px; /* Fixed height for each item in the reel */
                    display: flex;
                    align-items: center;
                    justify-content: center;
                }

                .reel-content-wrapper {
                    transition: transform 0.1s linear; /* For continuous fast spin */
                }

                .spinning .reel-content-wrapper {
                    animation: spinReel 0.1s linear infinite;
                }

                .stopped .reel-content-wrapper {
                    animation: none;
                    transition: transform 1s ease-out; /* For smooth stop */
                }
                `}
            </style>

            {showInstructions && (
                <div className="fixed inset-0 bg-black bg-opacity-70 flex items-center justify-center z-50 p-4">
                    <div className="bg-white rounded-xl shadow-2xl p-6 md:p-8 max-w-md w-full text-center transform transition-all duration-300 scale-100">
                        <h2 className="text-2xl font-bold text-purple-700 mb-4">Bienvenue au Jeu Coquin !</h2>
                        <p className="mb-4 text-gray-700">
                            Prépare-toi pour une expérience amusante !
                            <br /><br />
                            **Comment jouer :**
                            <br />
                            1.  Ajoute entre **2 et 10 joueurs**, en précisant leur sexe et leurs préférences.
                            2.  Le jeu progresse à travers **6 niveaux d'intensité** automatiquement, visualisés par une barre de tension.
                            3.  Lance la roue pour découvrir une combinaison coquine et un temps !
                            <br /><br />
                            Amuse-toi bien ! 😉
                        </p>
                        <button
                            onClick={() => { setShowInstructions(false); startAudioContext(); }} // Démarrer le contexte audio ici
                            className="bg-purple-600 hover:bg-purple-700 text-white font-bold py-2 px-6 rounded-full shadow-lg transition duration-300 ease-in-out transform hover:scale-105"
                        >
                            Commençons !
                        </button>
                    </div>
                </div>
            )}

            {showErrorModal && (
                <div className="fixed inset-0 bg-black bg-opacity-70 flex items-center justify-center z-50 p-4">
                    <div className="bg-white rounded-xl shadow-2xl p-6 md:p-8 max-w-md w-full text-center transform transition-all duration-300 scale-100">
                        <h2 className="text-2xl font-bold text-red-600 mb-4">Erreur !</h2>
                        <p className="mb-6 text-gray-700">{errorMessage}</p>
                        <button
                            onClick={() => setShowErrorModal(false)}
                            className="bg-red-500 hover:bg-red-600 text-white font-bold py-2 px-6 rounded-full shadow-lg transition duration-300 ease-in-out transform hover:scale-105"
                        >
                            Compris
                        </button>
                    </div>
                </div>
            )}

            {showLevelUpModal && (
                <div className="fixed inset-0 bg-black bg-opacity-70 flex items-center justify-center z-50 p-4">
                    <div className="bg-white rounded-xl shadow-2xl p-6 md:p-8 max-w-md w-full text-center transform transition-all duration-300 scale-100">
                        {/* Make the message content scrollable */}
                        <div className="max-h-[70vh] overflow-y-auto pr-2"> {/* Added max-h and overflow-y-auto */}
                            <h2 className="text-2xl font-bold text-green-600 mb-4">{levelUpTitle}</h2>
                            <p className="mb-6 text-gray-700" dangerouslySetInnerHTML={{ __html: levelUpMessage }}></p>
                        </div>
                        <button
                            onClick={() => setShowLevelUpModal(false)}
                            className="bg-green-500 hover:bg-green-600 text-white font-bold py-2 px-6 rounded-full shadow-lg transition duration-300 ease-in-out transform hover:scale-105 mt-4" // Added mt-4 for spacing
                        >
                            Continuer le jeu !
                        </button>
                    </div>
                </div>
            )}

            <h1 className="text-4xl md:text-5xl font-extrabold text-white text-center drop-shadow-lg mb-8">
                Jeu Coquin
            </h1>

            {/* Conteneur principal pour la mise en page flexible */}
            <div className="flex flex-col lg:flex-row lg:items-start lg:justify-center w-full max-w-7xl gap-8 p-4">

                {/* Colonne de gauche (ou en haut sur petits écrans) : Gestion Joueurs & Barre Tension */}
                <div className="flex flex-col gap-8 w-full lg:w-1/3">
                    {/* Section de gestion des joueurs */}
                    <div className="bg-white bg-opacity-80 backdrop-blur-sm rounded-xl shadow-xl p-6 md:p-8 w-full transition-all duration-300 transform hover:scale-105">
                        <h2 className="text-2xl font-bold text-purple-700 mb-4 text-center">Gestion des Joueurs</h2>
                        <div className="flex flex-col gap-3 mb-4">
                            <input
                                type="text"
                                value={newPlayerName}
                                onChange={(e) => setNewPlayerName(e.target.value)}
                                placeholder="Nom du joueur"
                                className="p-3 border border-purple-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-transparent outline-none transition duration-200"
                                onKeyPress={(e) => { if (e.key === 'Enter') addPlayer(); }}
                            />
                            <div className="flex flex-col sm:flex-row justify-around gap-3 mt-2">
                                <label className="flex items-center cursor-pointer">
                                    <input
                                        type="radio"
                                        name="newPlayerSex"
                                        value="homme"
                                        checked={newPlayerSex === 'homme'}
                                        onChange={(e) => setNewPlayerSex(e.target.value)}
                                        className="form-radio h-4 w-4 text-purple-600 transition duration-150 ease-in-out"
                                    />
                                    <span className="ml-2 text-gray-700">Homme</span>
                                </label>
                                <label className="flex items-center cursor-pointer">
                                    <input
                                        type="radio"
                                        name="newPlayerSex"
                                        value="femme"
                                        checked={newPlayerSex === 'femme'}
                                        onChange={(e) => setNewPlayerSex(e.target.value)}
                                        className="form-radio h-4 w-4 text-purple-600 transition duration-150 ease-in-out"
                                    />
                                    <span className="ml-2 text-gray-700">Femme</span>
                                </label>
                            </div>
                            <label className="flex items-center cursor-pointer mt-2">
                                <input
                                    type="checkbox"
                                    checked={newPlayerAcceptSameSex}
                                    onChange={(e) => setNewPlayerAcceptSameSex(e.target.checked)}
                                    className="form-checkbox h-4 w-4 text-purple-600 rounded transition duration-150 ease-in-out"
                                />
                                <span className="ml-2 text-gray-700">Accepte les actions avec le même sexe</span>
                            </label>
                            <div className="flex flex-col md:flex-row gap-3 mt-4">
                                <button
                                    onClick={addPlayer}
                                    disabled={players.length >= 10 || newPlayerName.trim() === ''}
                                    className="flex-grow bg-purple-500 hover:bg-purple-600 text-white font-semibold py-3 px-6 rounded-lg shadow-md transition duration-300 ease-in-out transform hover:scale-105 disabled:opacity-50 disabled:cursor-not-allowed"
                                >
                                    Ajouter Joueur
                                </button>
                                <button
                                    onClick={addTenPlayersAutomatically}
                                    disabled={players.length > 0} // Désactiver si des joueurs sont déjà présents
                                    className="flex-grow bg-blue-500 hover:bg-blue-600 text-white font-semibold py-3 px-6 rounded-lg shadow-md transition duration-300 ease-in-out transform hover:scale-105 disabled:opacity-50 disabled:cursor-not-allowed"
                                >
                                    Créer 10 Joueurs Auto
                                </button>
                            </div>
                        </div>
                        {players.length > 0 && (
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-4">
                                {players.map((player, index) => (
                                    <div
                                        key={index}
                                        className="flex flex-col items-start bg-purple-100 text-purple-800 py-2 px-4 rounded-lg shadow-sm text-sm font-medium relative"
                                    >
                                        <button
                                            onClick={() => removePlayer(index)}
                                            className="absolute top-1 right-2 text-purple-600 hover:text-purple-900 font-bold text-lg leading-none transition duration-200"
                                        >
                                            &times;
                                        </button>
                                        <span className="font-bold text-base">{player.name}</span>
                                        <span className="text-xs text-gray-600">Sexe: {player.sex === 'homme' ? 'Homme' : 'Femme'}</span>
                                        <span className="text-xs text-gray-600">Même sexe: {player.acceptSameSex ? 'Oui' : 'Non'}</span>
                                    </div>
                                ))}
                            </div>
                        )}
                        {players.length < 2 && (
                            <p className="text-sm text-red-600 mt-2 text-center">
                                Ajoute au moins {2 - players.length} joueur(s) pour commencer !
                            </p>
                        )}
                        {players.length >= 10 && (
                            <p className="text-sm text-orange-600 mt-2 text-center">
                                Maximum de 10 joueurs atteint !
                            </p>
                        )}

                        {/* Sélecteur de niveau */}
                        <div className="mt-6">
                            <label htmlFor="level-select" className="block text-lg font-bold text-purple-700 mb-2 text-center">
                                Aller au Niveau :
                            </label>
                            <select
                                id="level-select"
                                value={currentLevelIndex}
                                onChange={handleLevelChange}
                                className="block w-full p-3 border border-purple-300 rounded-lg bg-white focus:ring-2 focus:ring-purple-500 focus:border-transparent outline-none transition duration-200 text-center text-lg font-semibold"
                            >
                                {levelOrder.map((level, index) => (
                                    <option key={level.id} value={index}>
                                        {level.name}
                                    </option>
                                ))}
                            </select>
                        </div>
                    </div>

                    {/* Section de la barre de tension (remplace le thermomètre) */}
                    <div className="bg-white bg-opacity-80 backdrop-blur-sm rounded-xl shadow-xl p-6 md:p-8 w-full flex flex-col items-center transition-all duration-300 transform hover:scale-105">
                        <h2 className="text-2xl font-bold text-purple-700 mb-4 text-center">Tension Montante</h2>
                        <div className="relative w-20 h-48 bg-gray-200 rounded-full overflow-hidden border-4 border-purple-400 flex items-end justify-center">
                            {/* La barre de remplissage */}
                            <div
                                className="absolute bottom-0 w-full bg-gradient-to-t from-pink-500 to-red-600 transition-all duration-500 ease-in-out"
                                style={{ height: tensionFillHeight }}
                            ></div>
                            {/* La base ou le "point de départ" stylisé */}
                            <div className="absolute w-10 h-10 bg-red-700 rounded-full -bottom-5 border-4 border-purple-400"></div>
                            {/* La zone "culminante" stylisée en haut */}
                            <div className="absolute top-0 w-12 h-10 bg-gradient-to-br from-purple-500 to-pink-500 rounded-full opacity-90 border-4 border-purple-400 flex items-center justify-center">
                                <span className="text-white text-xl font-bold">💖</span> {/* Un petit emoji pour la touche finale */}
                            </div>
                            {/* Les marqueurs de niveau */}
                            <div className="absolute top-0 w-full h-full flex flex-col justify-between py-2 text-gray-700 font-semibold text-xs">
                                <span className="text-center">Niveau 6</span>
                                <span className="text-center">Niveau 5</span>
                                <span className="text-center">Niveau 4</span>
                                <span className="text-center">Niveau 3</span>
                                <span className="text-center">Niveau 2</span>
                                <span className="text-center">Niveau 1</span>
                            </div>
                        </div>
                        <p className="mt-4 text-lg font-semibold text-purple-800">
                            {levelOrder[currentLevelIndex].name}
                        </p>
                        <p className="text-sm text-gray-600 text-center">
                            Actions : <span className="font-semibold text-purple-700">{levelOrder[currentLevelIndex].actionType.charAt(0).toUpperCase() + levelOrder[currentLevelIndex].actionType.slice(1)}</span> /
                            Zones : <span className="font-semibold text-purple-700">{levelOrder[currentLevelIndex].bodyPartType.charAt(0).toUpperCase() + levelOrder[currentLevelIndex].bodyPartType.slice(1)}</span>
                        </p>
                    </div>
                </div>


                {/* Colonne de droite (ou en bas sur petits écrans) : Rouleaux & Contrôles du Jeu */}
                <div className="bg-white bg-opacity-80 backdrop-blur-sm rounded-xl shadow-xl p-6 md:p-8 w-full lg:w-2/3 text-center transition-all duration-300 transform hover:scale-105">
                    <h2 className="text-2xl font-bold text-purple-700 mb-6">Le Tirage Coquin</h2>

                    {/* Affichage des rouleaux pour les niveaux 1-5 */}
                    {currentLevelIndex < 5 && (
                        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4 mb-8">
                            <Reel reelRef={player1Ref} isSpinning={isSpinning} finalValue={result.isJokerChallenge ? 'J' : result.player1?.name} type={result.isJokerChallenge ? 'joker' : 'player'} />
                            <Reel reelRef={actionRef} isSpinning={isSpinning} finalValue={result.isJokerChallenge ? 'O' : result.action} type={result.isJokerChallenge ? 'joker' : 'action'} />
                            <Reel reelRef={bodyPartRef} isSpinning={isSpinning} finalValue={result.isJokerChallenge ? 'K' : result.bodyPart} type={result.isJokerChallenge ? 'joker' : 'bodyPart'} sex={result.player2?.sex} />
                            <Reel reelRef={player2Ref} isSpinning={isSpinning} finalValue={result.isJokerChallenge ? 'E' : result.player2?.name} type={result.isJokerChallenge ? 'joker' : 'player'} />
                            <Reel reelRef={countdownRef} isSpinning={isSpinning} finalValue={result.isJokerChallenge ? 'R' : (result.countdownTime ? `${result.countdownTime}s` : '???')} type={result.isJokerChallenge ? 'joker' : 'time'} />
                        </div>
                    )}

                    {/* Affichage des défis pour le Niveau 6 */}
                    {currentLevelIndex === 5 && (
                        <div className="mt-8 text-center">
                            <h3 className="text-3xl font-extrabold text-purple-900 mb-4">Défis de Fusion Ultime !</h3>
                            {level6Challenges && level6Challenges.length > 0 ? (
                                level6Challenges.map((group, idx) => (
                                    <p key={idx} className="text-2xl md:text-3xl font-extrabold text-purple-900 leading-tight mb-2">
                                        {group.players.map((player, pIdx) => (
                                            <React.Fragment key={player.name}>
                                                <span className={`font-bold ${player.sex === 'homme' ? 'text-blue-600' : 'text-pink-600'}`}>
                                                    {player.name}
                                                </span>
                                                {pIdx < group.players.length - 1 && (pIdx === group.players.length - 2 ? ' et ' : ', ')}
                                            </React.Fragment>
                                        ))}
                                        {' '} {group.challenge}
                                    </p>
                                ))
                            ) : (
                                <p className="text-xl text-gray-600">Aucun groupe formé pour le moment. Ajoutez des joueurs ou ajustez les préférences pour le Niveau 6.</p>
                            )}

                            {soloPlayersForLevel6.length > 0 && (
                                <div className="mt-8">
                                    <h4 className="text-2xl font-bold text-gray-700 mb-2">Défis Personnels :</h4>
                                    {soloPlayersForLevel6.map((player, idx) => (
                                        <p key={idx} className="text-xl md:text-2xl font-extrabold text-gray-800 leading-tight mb-1">
                                            <span className={`font-bold ${player.sex === 'homme' ? 'text-blue-600' : 'text-pink-600'}`}>
                                                {player.name}
                                            </span> est invité(e) à explorer son propre plaisir de manière autonome.
                                        </p>
                                    ))}
                                </div>
                            )}
                            {/* Le rouleau du temps est toujours visible et affiche le temps restant */}
                            <div className="relative bg-purple-50 p-2 rounded-lg shadow-inner border border-purple-200 flex flex-col items-center justify-center min-h-[80px] overflow-hidden mt-8 mx-auto max-w-[150px]">
                                <div className="h-12 flex items-center justify-center w-full">
                                    <p ref={countdownRef} className="text-xl font-bold text-purple-800 transition-all duration-75 ease-linear">
                                        {isCountingDown ? remainingTime : (result.countdownTime ? `${result.countdownTime}s` : '???')}
                                    </p>
                                </div>
                            </div>
                        </div>
                    )}


                    {/* Bouton de lancement - Simule le manche */}
                    <button
                        onClick={spinWheel}
                        disabled={players.length < 2 || isSpinning || isCountingDown}
                        className={`
                            relative
                            bg-gradient-to-r from-pink-500 to-purple-600 hover:from-pink-600 hover:to-purple-700
                            text-white font-bold py-4 px-10 rounded-full shadow-lg
                            transition-all duration-200 ease-in-out
                            transform
                            ${isSpinning ? 'scale-100' : 'hover:scale-105 active:scale-95 active:translate-y-1 active:shadow-none'}
                            disabled:opacity-50 disabled:cursor-not-allowed text-xl
                        `}
                    >
                        {isSpinning ? 'En cours...' : 'Lancer le Tirage !'}
                    </button>

                    {/* Bouton Lancer Compte à Rebours */}
                    {result.countdownTime > 0 && !isSpinning && (
                        <button
                            onClick={startCountdown}
                            disabled={isCountingDown}
                            className={`
                                mt-4
                                bg-gradient-to-r from-green-500 to-teal-600 hover:from-green-600 hover:to-teal-700
                                text-white font-bold py-3 px-8 rounded-full shadow-lg
                                transition-all duration-200 ease-in-out
                                transform hover:scale-105 active:scale-95 active:translate-y-1 active:shadow-none
                                disabled:opacity-50 disabled:cursor-not-allowed
                            `}
                        >
                            {isCountingDown ? `Compte à rebours : ${remainingTime}s` : 'Lancer le Compte à Rebours !'}
                        </button>
                    )}

                    {/* Bouton Changer de Défi Joker */}
                    {result.isJokerChallenge && !isSpinning && (
                        <button
                            onClick={changeJokerChallenge}
                            disabled={isSpinning || isCountingDown}
                            className={`
                                mt-4
                                bg-gradient-to-r from-orange-500 to-red-600 hover:from-orange-600 hover:to-red-700
                                text-white font-bold py-3 px-8 rounded-full shadow-lg
                                transition-all duration-200 ease-in-out
                                transform hover:scale-105 active:scale-95 active:translate-y-1 active:shadow-none
                                disabled:opacity-50 disabled:cursor-not-allowed
                            `}
                        >
                            Changer de Défi Joker
                        </button>
                    )}
                </div>
            </div>

            {/* Bouton Mode Admin (positionné en haut à droite) */}
            <button
                onClick={() => setIsAdminMode(!isAdminMode)}
                className={`
                    absolute top-4 right-4 z-10
                    bg-gray-700 hover:bg-gray-800 text-white font-bold py-2 px-6 rounded-full shadow-lg
                    transition duration-300 ease-in-out transform hover:scale-105
                `}
            >
                {isAdminMode ? 'Quitter Mode Admin' : 'Mode Admin'}
            </button>

            {/* Modal du mode Admin */}
            {isAdminMode && (
                <div className="fixed inset-0 bg-black bg-opacity-70 flex items-center justify-center z-50 p-4">
                    <div className="bg-white rounded-xl shadow-2xl p-6 md:p-8 max-w-4xl w-full text-center transform transition-all duration-300 scale-100 overflow-y-auto max-h-[90vh]">
                        <h2 className="text-3xl font-bold text-purple-700 mb-6">Mode Administrateur</h2>

                        {/* Authentification Admin */}
                        {!userId && ( // Si l'utilisateur n'est pas encore authentifié, on ne lui demande pas le mot de passe admin
                            <p className="text-red-500 mb-4">Authentification Firebase en cours...</p>
                        )}
                        {userId && ( // Si l'utilisateur est authentifié Firebase, on lui demande le mot de passe admin
                            <div className="mb-6">
                                <h3 className="text-xl font-bold text-gray-700 mb-3">Accès Admin</h3>
                                <input
                                    type="password"
                                    placeholder="Mot de passe Admin"
                                    value={adminPassword}
                                    onChange={(e) => setAdminPassword(e.target.value)}
                                    className="p-3 border border-gray-300 rounded-lg w-full max-w-xs focus:ring-2 focus:ring-purple-500 outline-none"
                                />
                                <button
                                    onClick={() => {
                                        if (adminPassword === ADMIN_SECRET_PASSWORD) {
                                            setErrorMessage('Accès Admin accordé !'); // Remplacé alert()
                                            setShowErrorModal(true); // Afficher le modal de succès/info
                                        } else {
                                            setErrorMessage('Mot de passe incorrect !'); // Remplacé alert()
                                            setShowErrorModal(true); // Afficher le modal d'erreur
                                            setAdminPassword('');
                                        }
                                    }}
                                    className="bg-purple-600 hover:bg-purple-700 text-white font-bold py-2 px-6 rounded-full shadow-lg mt-4 transition duration-300 ease-in-out"
                                >
                                    Valider
                                </button>
                            </div>
                        )}

                        {adminPassword === ADMIN_SECRET_PASSWORD && (
                            <div className="space-y-8 mt-8 text-left">
                                {/* Édition des Actions */}
                                <div>
                                    <h3 className="text-2xl font-bold text-purple-700 mb-4">Éditer les Actions</h3>
                                    {Object.keys(editableActions).map(level => (
                                        <div key={level} className="mb-6 p-4 border border-purple-200 rounded-lg bg-purple-50">
                                            <h4 className="text-xl font-semibold text-purple-800 mb-3 capitalize">{level}</h4>
                                            {editableActions[level].map((action, index) => (
                                                <div key={index} className="flex items-center gap-2 mb-2">
                                                    <input
                                                        type="text"
                                                        value={action}
                                                        onChange={(e) => {
                                                            const newActions = { ...editableActions };
                                                            newActions[level][index] = e.target.value;
                                                            setEditableActions(newActions);
                                                        }}
                                                        className="flex-grow p-2 border border-gray-300 rounded-lg focus:ring-1 focus:ring-purple-400 outline-none"
                                                    />
                                                    <button
                                                        onClick={() => {
                                                            const newActions = { ...editableActions };
                                                            newActions[level] = newActions[level].filter((_, i) => i !== index);
                                                            setEditableActions(newActions);
                                                        }}
                                                        className="bg-red-400 hover:bg-red-500 text-white p-2 rounded-full text-sm transition duration-200"
                                                    >
                                                        &times;
                                                    </button>
                                                </div>
                                            ))}
                                            <button
                                                onClick={() => {
                                                    const newActions = { ...editableActions };
                                                    newActions[level] = [...newActions[level], '']; // Ajouter un champ vide
                                                    setEditableActions(newActions);
                                                }}
                                                className="bg-green-500 hover:bg-green-600 text-white font-bold py-2 px-4 rounded-full text-sm mt-3 transition duration-200"
                                            >
                                                Ajouter Action
                                            </button>
                                        </div>
                                    ))}
                                    <button
                                        onClick={saveActionsData}
                                        className="bg-blue-500 hover:bg-blue-600 text-white font-bold py-2 px-6 rounded-full shadow-lg mt-4 transition duration-300 ease-in-out"
                                    >
                                        Sauvegarder Actions
                                    </button>
                                </div>

                                {/* Édition des Zones du Corps */}
                                <div>
                                    <h3 className="text-2xl font-bold text-purple-700 mb-4">Éditer les Zones du Corps</h3>
                                    {Object.keys(editableBodyParts).map(level => (
                                        <div key={level} className="mb-6 p-4 border border-purple-200 rounded-lg bg-purple-50">
                                            <h4 className="text-xl font-semibold text-purple-800 mb-3 capitalize">{level}</h4>
                                            {Object.keys(editableBodyParts[level]).map(sexCategory => (
                                                <div key={sexCategory} className="mb-4 pl-4 border-l-2 border-purple-300">
                                                    <h5 className="text-lg font-medium text-gray-700 mb-2 capitalize">{sexCategory}</h5>
                                                    {editableBodyParts[level][sexCategory].map((part, index) => (
                                                        <div key={`${level}-${sexCategory}-${index}`} className="flex items-center gap-2 mb-2">
                                                            <input
                                                                type="text"
                                                                value={part}
                                                                onChange={(e) => {
                                                                    const newBodyParts = { ...editableBodyParts };
                                                                    newBodyParts[level][sexCategory][index] = e.target.value;
                                                                    setEditableBodyParts(newBodyParts);
                                                                }}
                                                                className="flex-grow p-2 border border-gray-300 rounded-lg focus:ring-1 focus:ring-purple-400 outline-none"
                                                            />
                                                            <button
                                                                onClick={() => {
                                                                    const newBodyParts = { ...editableBodyParts };
                                                                    newBodyParts[level][sexCategory] = newBodyParts[level][sexCategory].filter((_, i) => i !== index);
                                                                    setEditableBodyParts(newBodyParts);
                                                                }}
                                                                className="bg-red-400 hover:bg-red-500 text-white p-2 rounded-full text-sm transition duration-200"
                                                            >
                                                                &times;
                                                            </button>
                                                        </div>
                                                    ))}
                                                    <button
                                                        onClick={() => {
                                                            const newBodyParts = { ...editableBodyParts };
                                                            newBodyParts[level][sexCategory] = [...newBodyParts[level][sexCategory], '']; // Ajouter un champ vide
                                                            setEditableBodyParts(newBodyParts);
                                                        }}
                                                        className="bg-green-500 hover:bg-green-600 text-white font-bold py-2 px-4 rounded-full text-sm mt-3 transition duration-200"
                                                    >
                                                        Ajouter Zone
                                                    </button>
                                                </div>
                                            ))}
                                        </div>
                                    ))}
                                    <button
                                        onClick={saveBodyPartsData}
                                        className="bg-blue-500 hover:bg-blue-600 text-white font-bold py-2 px-6 rounded-full shadow-lg mt-4 transition duration-300 ease-in-out"
                                    >
                                        Sauvegarder Zones du Corps
                                    </button>
                                </div>

                                {/* Édition des Défis Joker */}
                                <div>
                                    <h3 className="text-2xl font-bold text-purple-700 mb-4">Éditer les Défis Joker</h3>
                                    {Object.keys(editableJokerChallenges).map(level => (
                                        <div key={level} className="mb-6 p-4 border border-purple-200 rounded-lg bg-purple-50">
                                            <h4 className="text-xl font-semibold text-purple-800 mb-3 capitalize">{level}</h4>
                                            {editableJokerChallenges[level].map((challenge, index) => (
                                                <div key={challenge.id || index} className="mb-4 p-3 border border-purple-100 rounded-lg bg-white shadow-sm">
                                                    <div className="flex flex-col gap-2">
                                                        <label className="block text-gray-700 text-sm font-bold mb-1">Template du défi (utiliser {`{player1}`}, {`{player2}`}, {`{player3}`})</label>
                                                        <input
                                                            type="text"
                                                            value={challenge.template}
                                                            onChange={(e) => {
                                                                const newChallenges = { ...editableJokerChallenges };
                                                                newChallenges[level][index].template = e.target.value;
                                                                setEditableJokerChallenges(newChallenges);
                                                            }}
                                                            className="p-2 border border-gray-300 rounded-lg w-full focus:ring-1 focus:ring-purple-400 outline-none"
                                                            placeholder="Ex: {player1} doit embrasser {player2} sur {bodyPart}."
                                                        />
                                                        <label className="block text-gray-700 text-sm font-bold mb-1 mt-2">Joueurs nécessaires (1, 2, 3 ou 'all')</label>
                                                        <select
                                                            value={challenge.playersNeeded}
                                                            onChange={(e) => {
                                                                const newChallenges = { ...editableJokerChallenges };
                                                                newChallenges[level][index].playersNeeded = isNaN(parseInt(e.target.value)) ? e.target.value : parseInt(e.target.value);
                                                                setEditableJokerChallenges(newChallenges);
                                                            }}
                                                            className="p-2 border border-gray-300 rounded-lg w-full focus:ring-1 focus:ring-purple-400 outline-none"
                                                        >
                                                            <option value="1">1</option>
                                                            <option value="2">2</option>
                                                            <option value="3">3</option>
                                                            <option value="all">Tous</option>
                                                        </select>
                                                        <label className="block text-gray-700 text-sm font-bold mb-1 mt-2">Accessoires (séparés par des virgules)</label>
                                                        <input
                                                            type="text"
                                                            value={challenge.accessories ? challenge.accessories.join(', ') : ''}
                                                            onChange={(e) => {
                                                                const newChallenges = { ...editableJokerChallenges };
                                                                newChallenges[level][index].accessories = e.target.value.split(',').map(s => s.trim()).filter(s => s !== '');
                                                                setEditableJokerChallenges(newChallenges);
                                                            }}
                                                            className="p-2 border border-gray-300 rounded-lg w-full focus:ring-1 focus:ring-purple-400 outline-none"
                                                            placeholder="Ex: bandeau, glaçon"
                                                        />
                                                        <button
                                                            onClick={() => {
                                                                const newChallenges = { ...editableJokerChallenges };
                                                                newChallenges[level] = newChallenges[level].filter((_, i) => i !== index);
                                                                setEditableJokerChallenges(newChallenges);
                                                            }}
                                                            className="bg-red-400 hover:bg-red-500 text-white p-2 rounded-full text-sm mt-3 transition duration-200 self-end"
                                                        >
                                                            Supprimer ce défi
                                                        </button>
                                                    </div>
                                                </div>
                                            ))}
                                            <button
                                                onClick={() => {
                                                    const newChallenges = { ...editableJokerChallenges };
                                                    // Générer un ID unique pour le nouveau défi
                                                    const newId = `joker-${level}-${Date.now()}`;
                                                    newChallenges[level] = [...newChallenges[level], { id: newId, template: '', playersNeeded: 1, accessories: [] }];
                                                    setEditableJokerChallenges(newChallenges);
                                                }}
                                                className="bg-green-500 hover:bg-green-600 text-white font-bold py-2 px-4 rounded-full text-sm mt-3 transition duration-200"
                                            >
                                                Ajouter Nouveau Défi Joker
                                            </button>
                                        </div>
                                    ))}
                                    <button
                                        onClick={saveJokerChallengesData}
                                        className="bg-blue-500 hover:bg-blue-600 text-white font-bold py-2 px-6 rounded-full shadow-lg mt-4 transition duration-300 ease-in-out"
                                    >
                                        Sauvegarder Défis Joker
                                    </button>
                                </div>
                            </div>
                        )}

                        <button
                            onClick={() => {
                                setIsAdminMode(false);
                                setAdminPassword(''); // Réinitialiser le mot de passe à la fermeture
                            }}
                            className="bg-red-500 hover:bg-red-600 text-white font-bold py-2 px-6 rounded-full shadow-lg mt-8 transition duration-300 ease-in-out"
                        >
                            Fermer
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
};

export default App;
