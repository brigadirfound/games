// Stable cue IDs keep translation separate from scene timing.
export const OPENING = {
 stairs:{ru:['ВАШ ПОДЪЕЗД · 22:58','Вы возвращаетесь домой. Ещё один пролёт — и ваша дверь. В квартире №12, обычно пустой, горит свет.'],en:['YOUR BUILDING · 22:58','You are heading home. One more flight to your door. Flat 12 is usually empty. Tonight its light is on.']},
 accusation:{ru:['НЕЗНАКОМЕЦ','Ты опять к ней? Я слышал, как ты ходишь под дверью. Где Лена?'],en:['STRANGER','Back to see her? I heard you outside the door. Where is Lena?']},
 answer:{ru:['ВЫ','Я живу этажом выше. Вы меня с кем-то путаете. Дайте пройти.'],en:['YOU','I live upstairs. You have the wrong person. Let me past.']},
 threat:{ru:['НЕЗНАКОМЕЦ','Сначала скажешь, куда она ушла. Потом пойдёшь.'],en:['STRANGER','First you tell me where she went. Then you can go.']},
 grab:{ru:['','Лампа гаснет. В темноте слышны шаги.'],en:['','The light goes out. Footsteps in the dark.']},
 wake:{ru:['КВАРТИРА №12 · 23:00','Вы пришли в себя в чужой квартире. Мужчина у двери не выпускает вас. Он ищет Лену, но вы её не знаете. Рядом фонарь и старые фотографии. Нужно понять, что произошло, и найти выход.'],en:['FLAT 12 · 23:00','You wake in a stranger’s flat. The man at the door will not let you leave. He is looking for Lena, but you do not know her. A flashlight and old photographs lie nearby. Find out what happened and find a way out.']}
};
export const openingCopy=(id,language)=>OPENING[id][language==='ru'?'ru':'en'];
export function shouldShowOpening(platform,resume){const n=platform.load('campaignV2',null)?.night||1;return (!resume||n<=1)&&platform.load('storyOpeningV1',false)!==true;}
