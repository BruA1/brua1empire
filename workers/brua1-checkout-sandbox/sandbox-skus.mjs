// PUBLIC titles/IDs only. 36 tracks. Three owner-held tracks are excluded.
// Source: verified BruA1 108 staging SKU catalog; sandbox test purchases only.
export const MATRIX_TRACKS = Object.freeze([
  {
    "id": "BRUA1-INS-0001",
    "title": "108 in the Shade"
  },
  {
    "id": "BRUA1-INS-0002",
    "title": "Anxiety"
  },
  {
    "id": "BRUA1-INS-0003",
    "title": "Blaze"
  },
  {
    "id": "BRUA1-INS-0005",
    "title": "Cypher"
  },
  {
    "id": "BRUA1-INS-0006",
    "title": "Dallar and a Dream"
  },
  {
    "id": "BRUA1-INS-0007",
    "title": "Danger"
  },
  {
    "id": "BRUA1-INS-0008",
    "title": "decater"
  },
  {
    "id": "BRUA1-INS-0009",
    "title": "Drawdown"
  },
  {
    "id": "BRUA1-INS-0010",
    "title": "DreSlide"
  },
  {
    "id": "BRUA1-INS-0011",
    "title": "DrPepperFlavoredListerineJ"
  },
  {
    "id": "BRUA1-INS-0012",
    "title": "Elon Free"
  },
  {
    "id": "BRUA1-INS-0013",
    "title": "Fck Stress"
  },
  {
    "id": "BRUA1-INS-0014",
    "title": "Get Em"
  },
  {
    "id": "BRUA1-INS-0015",
    "title": "Ginu"
  },
  {
    "id": "BRUA1-INS-0016",
    "title": "Gnosis"
  },
  {
    "id": "BRUA1-INS-0017",
    "title": "JRSHIT2"
  },
  {
    "id": "BRUA1-INS-0018",
    "title": "Just2Inspire"
  },
  {
    "id": "BRUA1-INS-0020",
    "title": "Litty"
  },
  {
    "id": "BRUA1-INS-0021",
    "title": "Loving You"
  },
  {
    "id": "BRUA1-INS-0022",
    "title": "Mailvoi"
  },
  {
    "id": "BRUA1-INS-0023",
    "title": "Messy"
  },
  {
    "id": "BRUA1-INS-0024",
    "title": "Morf"
  },
  {
    "id": "BRUA1-INS-0025",
    "title": "Nawlins"
  },
  {
    "id": "BRUA1-INS-0027",
    "title": "Phareal"
  },
  {
    "id": "BRUA1-INS-0028",
    "title": "realfocus_2"
  },
  {
    "id": "BRUA1-INS-0029",
    "title": "Ride With Me"
  },
  {
    "id": "BRUA1-INS-0030",
    "title": "Shake it like"
  },
  {
    "id": "BRUA1-INS-0031",
    "title": "Shop Open"
  },
  {
    "id": "BRUA1-INS-0032",
    "title": "SpaceX"
  },
  {
    "id": "BRUA1-INS-0033",
    "title": "Steel"
  },
  {
    "id": "BRUA1-INS-0034",
    "title": "Stranger"
  },
  {
    "id": "BRUA1-INS-0035",
    "title": "Street Dreams"
  },
  {
    "id": "BRUA1-INS-0036",
    "title": "The Flu"
  },
  {
    "id": "BRUA1-INS-0037",
    "title": "Whoa Naa"
  },
  {
    "id": "BRUA1-INS-0038",
    "title": "Worse"
  },
  {
    "id": "BRUA1-INS-0039",
    "title": "Zayoo"
  }
].map(x=>Object.freeze(x)));
export const MATRIX_HELD_IDS = Object.freeze(["BRUA1-INS-0004","BRUA1-INS-0019","BRUA1-INS-0026"]);
export const MATRIX_TIERS = Object.freeze({basic:2999,premium:5999,unlimited:9999});
export const MATRIX_DRAFT_VERSION = "BRUA1-DRAFT-V2-2026-11-23";
export function sandboxSelection(id,tier){
 const t=MATRIX_TRACKS.find(x=>x.id===id);
 if(!t || MATRIX_HELD_IDS.includes(id) || !Object.hasOwn(MATRIX_TIERS,tier))return null;
 return {id:t.id,title:t.title,tier,priceCents:MATRIX_TIERS[tier],price:(MATRIX_TIERS[tier]/100).toFixed(2),currency:"USD",customId:t.id+":"+tier+":"+MATRIX_DRAFT_VERSION};
}
