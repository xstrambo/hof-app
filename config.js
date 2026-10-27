// Einstellungen der Hof-App. Hier steht nichts Geheimes: die Adresse des Briefkastens und der
// ÖFFENTLICHE Laptop-Schlüssel (damit kann man nur verschlüsseln, nicht lesen).
export default {
  attrappe: false,
  funktionUrl: 'https://mrcqaspirpwxomldzxeo.supabase.co/functions/v1/briefkasten',
  oeffentlicherSchluessel: '', // bleibt leer: der Briefkasten braucht keinen Supabase-Schlüssel
  laptopSchluessel: '',        // öffentlicher Schlüssel des Laptops (Base64, 65 Byte P-256), aus oeffentlich.txt
  live_text: 'handy',          // 'handy' = Spracherkennung des Handys; 'mistral' = Ausweichlösung, noch nicht eingerichtet
};
