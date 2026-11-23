import { z } from "zod";
import { OrgRoleSchema } from "./common.js";

// ISO 3166-1 alpha-2 assigned codes (the repository accepts uppercase codes only).
const countryCodes = new Set(
  "AD,AE,AF,AG,AI,AL,AM,AO,AQ,AR,AS,AT,AU,AW,AX,AZ,BA,BB,BD,BE,BF,BG,BH,BI,BJ,BL,BM,BN,BO,BQ,BR,BS,BT,BV,BW,BY,BZ,CA,CC,CD,CF,CG,CH,CI,CK,CL,CM,CN,CO,CR,CU,CV,CW,CX,CY,CZ,DE,DJ,DK,DM,DO,DZ,EC,EE,EG,EH,ER,ES,ET,FI,FJ,FK,FM,FO,FR,GA,GB,GD,GE,GF,GG,GH,GI,GL,GM,GN,GP,GQ,GR,GS,GT,GU,GW,GY,HK,HM,HN,HR,HT,HU,ID,IE,IL,IM,IN,IO,IQ,IR,IS,IT,JE,JM,JO,JP,KE,KG,KH,KI,KM,KN,KP,KR,KW,KY,KZ,LA,LB,LC,LI,LK,LR,LS,LT,LU,LV,LY,MA,MC,MD,ME,MF,MG,MH,MK,ML,MM,MN,MO,MP,MQ,MR,MS,MT,MU,MV,MW,MX,MY,MZ,NA,NC,NE,NF,NG,NI,NL,NO,NP,NR,NU,NZ,OM,PA,PE,PF,PG,PH,PK,PL,PM,PN,PR,PS,PT,PW,PY,QA,RE,RO,RS,RU,RW,SA,SB,SC,SD,SE,SG,SH,SI,SJ,SK,SL,SM,SN,SO,SR,SS,ST,SV,SX,SY,SZ,TC,TD,TF,TG,TH,TJ,TK,TL,TM,TN,TO,TR,TT,TV,TW,TZ,UA,UG,UM,US,UY,UZ,VA,VC,VE,VG,VI,VN,VU,WF,WS,YE,YT,ZA,ZM,ZW".split(
    ",",
  ),
);

export const SellerOnboardingStatusSchema = z.enum([
  "pending",
  "stripe_pending",
  "under_review",
  "active",
  "suspended",
  "closed",
]);
export type SellerOnboardingStatus = z.infer<typeof SellerOnboardingStatusSchema>;

/** A "seller" is a Better Auth Organization + extra commerce metadata owned by seller-service. */
export const SellerSchema = z.object({
  id: z.string(),
  organizationId: z.string(), // Better Auth organization.id
  storeName: z.string().min(2).max(100),
  slug: z.string().min(2).max(100),
  description: z.string().max(2000).nullish(),
  logoUrl: z.string().url().nullish(),
  stripeAccountId: z.string().nullish(),
  status: SellerOnboardingStatusSchema.default("pending"),
  createdAt: z.coerce.date(),
});
export type Seller = z.infer<typeof SellerSchema>;

export const SellerMemberSchema = z.object({
  userId: z.string(),
  organizationId: z.string(),
  role: OrgRoleSchema,
});
export type SellerMember = z.infer<typeof SellerMemberSchema>;

export const CreateSellerInputSchema = SellerSchema.pick({
  storeName: true,
  slug: true,
  description: true,
})
  .extend({
    country: z
      .string()
      .regex(/^[A-Z]{2}$/)
      .refine(
        (country) => countryCodes.has(country),
        "Use an uppercase ISO 3166-1 alpha-2 country code",
      ),
    supportEmail: z.email(),
  })
  .strict();
export type CreateSellerInput = z.infer<typeof CreateSellerInputSchema>;
