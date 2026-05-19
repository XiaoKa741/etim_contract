'use client';

import { useState } from 'react';
import { CONTRACTS } from '@/config/contracts';
import { useTranslation, type Locale } from '@/lib/i18n';

type ArticleId = 'etim-whitepaper' | 'depin-intro' | 'depin-guide';

type ArticleMeta = {
  id: ArticleId;
  title: string;
  subtitle: string;
};

type IntroSection = {
  id: string;
  title: string;
  paragraphs: string[];
  bullets?: string[];
};

type GuideSection = {
  id: string;
  title: string;
  paragraphs: string[];
  images?: { src: string; alt: string }[];
};

const ARTICLE_META: Record<Locale, ArticleMeta[]> = {
  en: [
    { id: 'etim-whitepaper', title: 'ETIM Whitepaper', subtitle: 'Original whitepaper content' },
    { id: 'depin-intro', title: 'DePIN-Wemark Introduction', subtitle: 'Product concept and core model' },
    { id: 'depin-guide', title: 'DePIN-Wemark Current Guide', subtitle: 'Current version usage instructions' }
  ],
  zh: [
    { id: 'etim-whitepaper', title: 'ETIM 白皮书', subtitle: '原版白皮书内容' },
    { id: 'depin-intro', title: 'DePIN-Wemark 介绍', subtitle: '产品定位与核心机制' },
    { id: 'depin-guide', title: 'DePIN-Wemark 现版本说明', subtitle: '当前版本使用指南' }
  ],
  'zh-TW': [
    { id: 'etim-whitepaper', title: 'ETIM 白皮書', subtitle: '原版白皮書內容' },
    { id: 'depin-intro', title: 'DePIN-Wemark 介紹', subtitle: '產品定位與核心機制' },
    { id: 'depin-guide', title: 'DePIN-Wemark 現版本說明', subtitle: '目前版本使用指南' }
  ],
  ja: [
    { id: 'etim-whitepaper', title: 'ETIM ホワイトペーパー', subtitle: '初期版ホワイトペーパー内容' },
    { id: 'depin-intro', title: 'DePIN-Wemark 紹介', subtitle: 'プロダクト概念と主要モデル' },
    { id: 'depin-guide', title: 'DePIN-Wemark 現行ガイド', subtitle: '現行バージョン利用説明' }
  ],
  ko: [
    { id: 'etim-whitepaper', title: 'ETIM 백서', subtitle: '원본 백서 내용' },
    { id: 'depin-intro', title: 'DePIN-Wemark 소개', subtitle: '제품 포지셔닝과 핵심 메커니즘' },
    { id: 'depin-guide', title: 'DePIN-Wemark 최신 버전 안내', subtitle: '현재 버전 사용 설명' }
  ],
  es: [
    { id: 'etim-whitepaper', title: 'Whitepaper de ETIM', subtitle: 'Contenido original del whitepaper' },
    { id: 'depin-intro', title: 'Introduccion de DePIN-Wemark', subtitle: 'Concepto del producto y modelo central' },
    { id: 'depin-guide', title: 'Guia Actual de DePIN-Wemark', subtitle: 'Instrucciones de uso de la version actual' }
  ]
};

const INTRO_CONTENT: Record<Locale, { title: string; subtitle: string; sections: IntroSection[] }> = {
  en: {
    title: 'DePIN-Wemark Introduction',
    subtitle: 'From online discovery to trusted offline social experiences',
    sections: [
      {
        id: 'intro-product',
        title: '1. Product Positioning',
        paragraphs: [
          'WEMARK is an offline social platform where people discover nearby users through short videos and quickly schedule real-world meetups.',
          'It is designed as a closed loop: discover online, build intent with deposits, meet offline, and leave mutual reviews.'
        ],
        bullets: [
          'Vertical feed browsing, similar to short-video apps',
          'Price-based role expression for different social intentions',
          'Deposit and review mechanisms to improve trust and completion rates'
        ]
      },
      {
        id: 'intro-roles',
        title: '2. Pricing Defines Role',
        paragraphs: [
          'A positive price means service/talent offer, a negative price means bounty request, and zero means free social interaction.',
          'Users can publish multiple posts and play different roles in different scenarios.'
        ],
        bullets: [
          'Price > 0: Creator/Service provider',
          'Price < 0: Bounty sponsor',
          'Price = 0: Free social mode'
        ]
      },
      {
        id: 'intro-trust',
        title: '3. Trust and Reputation Layer',
        paragraphs: [
          'WEMARK uses two parallel indicators to describe user quality:',
          'Ratings come from completed meetup reviews, while level badges come from accumulated tipping performance.'
        ],
        bullets: ['Rating: reliability and service quality', 'Level: popularity and engagement strength']
      },
      {
        id: 'intro-deposit',
        title: '4. Deposit Mechanism',
        paragraphs: [
          'Reservations require a coin deposit (minimum 100 coins) to express commitment and reduce no-shows.',
          'Refund and settlement outcomes are rule-based and transparent, depending on acceptance and cancellation timing.'
        ]
      }
    ]
  },
  zh: {
    title: 'DePIN-Wemark 介绍',
    subtitle: '从线上发现到线下见面的可信社交闭环',
    sections: [
      {
        id: 'intro-product',
        title: '1. 产品定位',
        paragraphs: [
          'WEMARK 是一款线下社交平台，用户通过短视频发现附近的人，并快速发起线下预约。',
          '平台强调完整闭环：线上发现、订金表达诚意、线下见面、互评沉淀信誉。'
        ],
        bullets: ['全屏竖滑浏览，降低发现成本', '价格表达角色，匹配不同社交诉求', '订金 + 互评机制，显著降低放鸽子概率']
      },
      {
        id: 'intro-roles',
        title: '2. 价格即身份',
        paragraphs: [
          '价格大于 0 代表可提供才艺/服务，价格小于 0 代表发起悬赏需求，价格等于 0 代表纯交友。',
          '同一用户可在不同内容中切换不同身份，提高场景灵活性。'
        ],
        bullets: ['价格 > 0：明星/服务方', '价格 < 0：金主/需求方', '价格 = 0：免费社交']
      },
      {
        id: 'intro-trust',
        title: '3. 双重信誉体系',
        paragraphs: [
          '平台通过“评级 + 等级”双维度刻画用户质量。',
          '评级来自见面后的互评，体现靠谱程度；等级来自累计打赏，体现人气与活跃度。'
        ],
        bullets: ['评级：服务质量与履约可信度', '等级：受欢迎程度与互动热度']
      },
      {
        id: 'intro-deposit',
        title: '4. 订金机制',
        paragraphs: [
          '发起预约需支付金币订金（最低 100 金币），通过资金约束提升双方履约意愿。',
          '订金的退款与结算由规则自动判定，依据接受与取消时机执行。'
        ]
      }
    ]
  },
  'zh-TW': {
    title: 'DePIN-Wemark 介紹',
    subtitle: '從線上探索到線下見面的可信社交閉環',
    sections: [
      {
        id: 'intro-product',
        title: '1. 產品定位',
        paragraphs: ['WEMARK 是一款線下社交平台，透過短影片探索附近的人並快速發起線下預約。', '平台採用閉環流程：線上發現、訂金建立誠意、線下見面、互評沉澱信任。']
      },
      {
        id: 'intro-roles',
        title: '2. 價格即身分',
        paragraphs: ['價格大於 0 表示提供服務/才藝，價格小於 0 表示發布懸賞，價格等於 0 表示純社交模式。']
      },
      {
        id: 'intro-trust',
        title: '3. 雙重信譽機制',
        paragraphs: ['評級來自線下完成後的互評，等級來自累積打賞，分別代表可靠度與人氣。']
      },
      {
        id: 'intro-deposit',
        title: '4. 訂金機制',
        paragraphs: ['預約需支付最低 100 金幣訂金，降低爽約並提升赴約率。']
      }
    ]
  },
  ja: {
    title: 'DePIN-Wemark 紹介',
    subtitle: 'オンライン発見からオフライン面会までの信頼ループ',
    sections: [
      {
        id: 'intro-product',
        title: '1. プロダクトの位置付け',
        paragraphs: ['WEMARK は、ショート動画で近くの人を見つけてオフラインで会う約束を作る DePIN プラットフォームです。', 'オンライン発見、デポジット、対面、相互レビューの一連の流れで信頼を構築します。']
      },
      {
        id: 'intro-roles',
        title: '2. 価格で役割を表現',
        paragraphs: ['価格 > 0 は提供者、価格 < 0 は募集者、価格 = 0 は無料交流を意味します。']
      },
      {
        id: 'intro-trust',
        title: '3. 信頼評価の二軸',
        paragraphs: ['評価は対面後レビュー、レベルはチップ実績に基づき、信頼性と人気を分けて可視化します。']
      },
      {
        id: 'intro-deposit',
        title: '4. デポジット機構',
        paragraphs: ['予約時のデポジット（最低 100 コイン）で、無断キャンセルを減らします。']
      }
    ]
  },
  ko: {
    title: 'DePIN-Wemark 소개',
    subtitle: '온라인 발견에서 오프라인 만남까지 신뢰 루프',
    sections: [
      {
        id: 'intro-product',
        title: '1. 제품 포지셔닝',
        paragraphs: ['WEMARK는 숏폼 콘텐츠로 주변 사용자를 찾고 오프라인 약속까지 연결하는 DePIN 플랫폼입니다.', '온라인 발견, 보증금, 오프라인 만남, 상호 리뷰로 신뢰를 형성합니다.']
      },
      {
        id: 'intro-roles',
        title: '2. 가격 기반 역할',
        paragraphs: ['가격 > 0은 서비스 제공, 가격 < 0은 보상 모집, 가격 = 0은 무료 소셜 모드를 의미합니다.']
      },
      {
        id: 'intro-trust',
        title: '3. 이중 신뢰 체계',
        paragraphs: ['평점은 만남 후 리뷰를, 레벨은 누적 팁 성과를 반영해 신뢰도와 인기도를 함께 보여줍니다.']
      },
      {
        id: 'intro-deposit',
        title: '4. 보증금 메커니즘',
        paragraphs: ['예약 시 최소 100 코인 보증금으로 노쇼를 줄이고 이행률을 높입니다.']
      }
    ]
  },
  es: {
    title: 'Introduccion de DePIN-Wemark',
    subtitle: 'Del descubrimiento online al encuentro offline con confianza',
    sections: [
      {
        id: 'intro-product',
        title: '1. Posicionamiento del producto',
        paragraphs: ['WEMARK es una plataforma DePIN para descubrir personas cercanas con video corto y concertar encuentros offline.', 'Su flujo cerrado combina descubrimiento, deposito de compromiso, reunion y evaluacion mutua.']
      },
      {
        id: 'intro-roles',
        title: '2. El precio define el rol',
        paragraphs: ['Precio > 0 indica oferta de servicio, precio < 0 indica solicitud con recompensa y precio = 0 indica interaccion social gratuita.']
      },
      {
        id: 'intro-trust',
        title: '3. Sistema doble de confianza',
        paragraphs: ['La calificacion refleja cumplimiento y calidad; el nivel refleja popularidad y actividad por propinas acumuladas.']
      },
      {
        id: 'intro-deposit',
        title: '4. Mecanismo de deposito',
        paragraphs: ['La reserva exige un deposito minimo de 100 monedas para reducir cancelaciones y mejorar la asistencia real.']
      }
    ]
  }
};

const GUIDE_CONTENT: Record<Locale, { title: string; subtitle: string; sections: GuideSection[] }> = {
  en: {
    title: 'DePIN-Wemark Current Guide',
    subtitle: 'Current app workflow and operation manual',
    sections: [
      {
        id: 'guide-wallet',
        title: '1. Wallet Login & Staking',
        paragraphs: [
          'Log in to wemark.etim.io and connect your wallet.',
          'Open your personal panel and click "Staking" to stake ETIM. Staking can be withdrawn anytime without principal loss.',
          'Staking contract address: 0xbffE782B37f8587bff9cC84597CC84597C'
        ],
        images: [{ src: '/wemark/page1.jpg', alt: 'WEMARK wallet login and staking' }]
      },
      {
        id: 'guide-bind',
        title: '2. Bind Account to Receive Coins',
        paragraphs: [
          'Rewarded coins are delivered to the email linked to your wallet profile.',
          'Go to "Bind Account", enter your email, complete verification, and bind successfully.',
          'Log in to the app with the same account to view your rewards.'
        ],
        images: [{ src: '/wemark/page2.jpg', alt: 'WEMARK bind account flow' }]
      },
      {
        id: 'guide-app',
        title: '3. App Basics',
        paragraphs: [
          'After receiving coins, you can make appointments, tip creators, and exchange custom skins in the app.',
          'The app has two major areas: Reservation and Time. Reservation is for activities. Time is for recording memorable moments.',
          'Download the APK from the official site or open wemark.online on mobile.'
        ],
        images: [{ src: '/wemark/page3.jpg', alt: 'WEMARK app login and usage' }]
      },
      {
        id: 'guide-create',
        title: '4. Content & Appointment Rules',
        paragraphs: [
          'Tap the middle "+" button to upload videos or create appointments.',
          'Time videos earn basic points. Appointment short videos earn by likes, comments, and completed appointments.',
          'Completing offline appointments with mutual reviews also gives reward points.'
        ],
        images: [{ src: '/wemark/page4.jpg', alt: 'WEMARK post type and invite rewards' }]
      },
      {
        id: 'guide-invite',
        title: '5. Invitation Relationship',
        paragraphs: [
          'In the "My" page, open Invitation to view your invitation code.',
          'You can enter others invitation codes there or on the login page to build referral relationships.',
          'The invited user gets app points, and the inviter also receives reward points.'
        ]
      }
    ]
  },
  zh: {
    title: 'DePIN-Wemark 现版本说明',
    subtitle: '当前版本的操作路径与使用规则',
    sections: [
      {
        id: 'guide-wallet',
        title: '1. 钱包登录与质押',
        paragraphs: ['进入 wemark.etim.io，连接钱包登录。', '在个人面板点击「Staking」质押 ETIM，可随时赎回且不损失本金。', '质押合约地址：0xbffE782B37f8587bff9cC84597CC84597C'],
        images: [{ src: '/wemark/page1.jpg', alt: 'WEMARK 钱包登录与质押' }]
      },
      {
        id: 'guide-bind',
        title: '2. 绑定账号领取金币',
        paragraphs: ['奖励金币会发放到钱包绑定的邮箱账户。', '在面板中进入「Bind Account」，填写邮箱并完成验证码校验。', '使用同一账号登录 APP 后即可查看奖励金币。'],
        images: [{ src: '/wemark/page2.jpg', alt: 'WEMARK 账号绑定流程' }]
      },
      {
        id: 'guide-app',
        title: '3. APP 基础玩法',
        paragraphs: ['领取金币后可在 APP 内进行预约、打赏与兑换皮肤。', 'APP 分为「预约」与「时刻」两大模块：预约用于活动组织，时刻用于生活内容记录。', '可从官网下载安装 APK，或手机访问 wemark.online 直接打开。'],
        images: [{ src: '/wemark/page3.jpg', alt: 'WEMARK APP 使用说明' }]
      },
      {
        id: 'guide-create',
        title: '4. 内容发布与积分规则',
        paragraphs: ['点击底部中间「+」发布视频或发起预约。', '时刻视频获得基础积分；预约类短视频按点赞、评论、实际赴约结果获得积分。', '完成线下赴约并互评，同样可获得积分奖励。'],
        images: [{ src: '/wemark/page4.jpg', alt: 'WEMARK 发布与积分规则' }]
      },
      {
        id: 'guide-invite',
        title: '5. 邀请关系与加成',
        paragraphs: ['在「我的」页面可查看个人邀请码。', '可在该页面或登录页填写他人邀请码，建立邀请关系。', '被邀请者获得积分的同时，邀请人也会得到奖励积分。']
      }
    ]
  },
  'zh-TW': {
    title: 'DePIN-Wemark 現版本說明',
    subtitle: '目前版本操作與使用規則',
    sections: [
      { id: 'guide-wallet', title: '1. 錢包登入與質押', paragraphs: ['進入 wemark.etim.io，連接錢包登入。', '在個人面板點擊「Staking」質押 ETIM，可隨時贖回且不損失本金。', '質押合約地址：0xbffE782B37f8587bff9cC84597CC84597C'], images: [{ src: '/wemark/page1.jpg', alt: 'WEMARK 錢包登入與質押' }] },
      { id: 'guide-bind', title: '2. 綁定帳號領取金幣', paragraphs: ['獎勵金幣會發放到錢包綁定的信箱帳號。', '在面板中進入「Bind Account」，填寫信箱並完成驗證。', '使用同一帳號登入 APP 後即可查看獎勵金幣。'], images: [{ src: '/wemark/page2.jpg', alt: 'WEMARK 帳號綁定流程' }] },
      { id: 'guide-app', title: '3. APP 基礎玩法', paragraphs: ['領取金幣後可在 APP 內進行預約、打賞與兌換皮膚。', 'APP 分為「預約」與「時刻」兩大模組。', '可從官網下載 APK，或手機訪問 wemark.online 使用。'], images: [{ src: '/wemark/page3.jpg', alt: 'WEMARK APP 使用說明' }] },
      { id: 'guide-create', title: '4. 內容發佈與積分規則', paragraphs: ['點擊底部中間「+」發佈影片或發起預約。', '時刻影片獲得基礎積分；預約短影片依照互動與實際赴約結果獲得積分。', '完成線下赴約並互評，同樣可獲得積分獎勵。'], images: [{ src: '/wemark/page4.jpg', alt: 'WEMARK 發佈與積分規則' }] },
      { id: 'guide-invite', title: '5. 邀請關係與加成', paragraphs: ['在「我的」頁面可查看個人邀請碼。', '可在該頁或登入頁填寫他人邀請碼，建立邀請關係。', '被邀請者與邀請者都可獲得積分獎勵。'] }
    ]
  },
  ja: {
    title: 'DePIN-Wemark 現行ガイド',
    subtitle: '現行バージョンの操作と利用ルール',
    sections: [
      { id: 'guide-wallet', title: '1. ウォレット接続とステーキング', paragraphs: ['wemark.etim.io にアクセスしてウォレットを接続します。', '個人パネルの「Staking」で ETIM をステーキング可能。元本を失わず、いつでも引き出しできます。', 'ステーキングコントラクト: 0xbffE782B37f8587bff9cC84597CC84597C'], images: [{ src: '/wemark/page1.jpg', alt: 'WEMARK ウォレット接続とステーキング' }] },
      { id: 'guide-bind', title: '2. アカウント連携でコイン受取', paragraphs: ['報酬コインはウォレットに紐づいたメールへ配布されます。', '「Bind Account」でメール入力と認証を完了します。', '同じアカウントで APP にログインすると報酬を確認できます。'], images: [{ src: '/wemark/page2.jpg', alt: 'WEMARK アカウント連携フロー' }] },
      { id: 'guide-app', title: '3. APP 基本機能', paragraphs: ['コイン獲得後、APP で予約・チップ・スキン交換が可能です。', 'APP は「予約」と「タイム」の2領域で構成されます。', '公式サイトの APK またはスマホの wemark.online で利用できます。'], images: [{ src: '/wemark/page3.jpg', alt: 'WEMARK APP 利用説明' }] },
      { id: 'guide-create', title: '4. 投稿とポイント規則', paragraphs: ['中央の「+」から動画投稿または予約作成が可能です。', 'タイム動画は基礎ポイント、予約動画は反応と成約結果に応じてポイントを獲得。', 'オフライン予約完了後の相互評価でもポイント報酬があります。'], images: [{ src: '/wemark/page4.jpg', alt: 'WEMARK 投稿とポイント規則' }] },
      { id: 'guide-invite', title: '5. 招待関係', paragraphs: ['「My」ページで自分の招待コードを確認できます。', '同ページまたはログインページで他人の招待コードを入力できます。', '被招待者と招待者の双方に報酬ポイントが付与されます。'] }
    ]
  },
  ko: {
    title: 'DePIN-Wemark 최신 버전 안내',
    subtitle: '현재 버전의 사용 흐름과 운영 규칙',
    sections: [
      { id: 'guide-wallet', title: '1. 지갑 로그인 및 스테이킹', paragraphs: ['wemark.etim.io에 접속해 지갑을 연결합니다.', '개인 패널의 "Staking"에서 ETIM을 스테이킹할 수 있으며 원금 손실 없이 출금 가능합니다.', '스테이킹 컨트랙트: 0xbffE782B37f8587bff9cC84597CC84597C'], images: [{ src: '/wemark/page1.jpg', alt: 'WEMARK 지갑 로그인 및 스테이킹' }] },
      { id: 'guide-bind', title: '2. 계정 연동 후 코인 수령', paragraphs: ['보상 코인은 지갑에 연결된 이메일 계정으로 지급됩니다.', '"Bind Account"에서 이메일 입력 및 인증을 완료하세요.', '동일 계정으로 APP 로그인 시 보상 코인을 확인할 수 있습니다.'], images: [{ src: '/wemark/page2.jpg', alt: 'WEMARK 계정 연동 흐름' }] },
      { id: 'guide-app', title: '3. APP 기본 사용', paragraphs: ['코인 획득 후 APP에서 예약, 팁, 스킨 교환이 가능합니다.', 'APP는 "예약"과 "타임" 두 영역으로 구성됩니다.', '공식 사이트 APK 또는 모바일 wemark.online으로 이용할 수 있습니다.'], images: [{ src: '/wemark/page3.jpg', alt: 'WEMARK APP 사용 설명' }] },
      { id: 'guide-create', title: '4. 콘텐츠 및 포인트 규칙', paragraphs: ['가운데 "+" 버튼으로 영상 업로드 또는 예약 생성이 가능합니다.', '타임 영상은 기본 포인트, 예약 영상은 상호작용과 실제 이행 결과에 따라 포인트를 획득합니다.', '오프라인 예약 완료 후 상호 평가 시 추가 포인트가 지급됩니다.'], images: [{ src: '/wemark/page4.jpg', alt: 'WEMARK 콘텐츠 및 포인트 규칙' }] },
      { id: 'guide-invite', title: '5. 초대 관계', paragraphs: ['"내 정보" 화면에서 초대 코드를 확인할 수 있습니다.', '해당 화면 또는 로그인 화면에서 다른 사용자 코드를 입력할 수 있습니다.', '초대받은 사용자와 초대한 사용자 모두 보상 포인트를 받습니다.'] }
    ]
  },
  es: {
    title: 'Guia Actual de DePIN-Wemark',
    subtitle: 'Flujo operativo y reglas de la version actual',
    sections: [
      { id: 'guide-wallet', title: '1. Conexion de wallet y staking', paragraphs: ['Inicia sesion en wemark.etim.io y conecta tu wallet.', 'En el panel personal, entra en "Staking" para bloquear ETIM. Puedes retirarlo sin perdida del principal.', 'Contrato de staking: 0xbffE782B37f8587bff9cC84597CC84597C'], images: [{ src: '/wemark/page1.jpg', alt: 'WEMARK wallet y staking' }] },
      { id: 'guide-bind', title: '2. Vincular cuenta para recibir monedas', paragraphs: ['Las monedas de recompensa se envian al correo asociado a tu wallet.', 'Entra en "Bind Account", escribe tu correo y completa la verificacion.', 'Al iniciar sesion en la APP con la misma cuenta veras las recompensas.'], images: [{ src: '/wemark/page2.jpg', alt: 'WEMARK flujo de vinculacion' }] },
      { id: 'guide-app', title: '3. Uso basico de la APP', paragraphs: ['Despues de recibir monedas, puedes hacer reservas, dar propinas y canjear skins.', 'La APP se divide en "Reserva" y "Tiempo".', 'Descarga el APK desde la web oficial o abre wemark.online desde el movil.'], images: [{ src: '/wemark/page3.jpg', alt: 'WEMARK uso de la app' }] },
      { id: 'guide-create', title: '4. Publicacion y reglas de puntos', paragraphs: ['Pulsa "+" en el centro para subir videos o crear reservas.', 'Los videos de Tiempo dan puntos base; los de Reserva dependen de likes, comentarios y cumplimiento real.', 'Completar una cita offline con evaluacion mutua tambien otorga puntos.'], images: [{ src: '/wemark/page4.jpg', alt: 'WEMARK publicacion y puntos' }] },
      { id: 'guide-invite', title: '5. Sistema de invitacion', paragraphs: ['En "Mi" puedes ver tu codigo de invitacion.', 'Puedes ingresar codigos de otros usuarios en esa pagina o en el login.', 'El invitado y el invitador reciben puntos de recompensa.'] }
    ]
  }
};

const WHITEPAPER_TEXT: Record<Locale, { overview: string[] }> = {
  en: {
    overview: [
      'ETIM (Eternal Imprint) is a decentralized participation and mining ecosystem built on Ethereum. Users deposit ETH to mine ETIM tokens through a growth pool mechanism. The system features a 7-tier level structure (S0-S6), an on-chain referral network, Node NFTs for enhanced rewards, and automated Uniswap v4 liquidity management with a built-in tax hook.',
      'The protocol is designed to be fully on-chain with no centralized control over user funds. All reward calculations, level determinations, and distribution logic execute through verified smart contracts.'
    ]
  },
  zh: {
    overview: [
      'ETIM（Eternal Imprint）是构建在以太坊上的去中心化参与与挖矿生态。用户通过存入 ETH 进入增长池机制挖取 ETIM。系统包含 7 级等级结构（S0-S6）、链上推荐网络、用于增强收益的 Node NFT，以及内置税费钩子的 Uniswap v4 自动流动性管理。',
      '协议以全链上执行为核心，不由中心化机构托管用户资金。奖励计算、等级判定与分配逻辑均通过可验证智能合约完成。'
    ]
  },
  'zh-TW': {
    overview: [
      'ETIM（Eternal Imprint）是建立在以太坊上的去中心化參與與挖礦生態。使用者透過存入 ETH 進入成長池機制挖取 ETIM。系統包含 7 級結構（S0-S6）、鏈上推薦關係、Node NFT 增益，以及帶稅費 Hook 的 Uniswap v4 自動流動性管理。',
      '協議採用全鏈上執行，無中心化機構代管用戶資金。獎勵計算、等級判定與分配邏輯均透過可驗證智能合約完成。'
    ]
  },
  ja: {
    overview: [
      'ETIM（Eternal Imprint）は Ethereum 上に構築された分散型の参加型マイニングエコシステムです。ユーザーは ETH を預け入れて、成長プールを通じて ETIM をマイニングします。7 段階レベル（S0-S6）、オンチェーン紹介ネットワーク、Node NFT、税フック付き Uniswap v4 自動流動性管理を備えています。',
      '本プロトコルは完全オンチェーン設計で、ユーザー資産を中央集権的に管理しません。報酬計算、レベル判定、分配ロジックは検証可能なスマートコントラクトで実行されます。'
    ]
  },
  ko: {
    overview: [
      'ETIM(Eternal Imprint)은 이더리움 기반의 탈중앙 참여형 채굴 생태계입니다. 사용자는 ETH를 예치해 성장 풀 메커니즘으로 ETIM을 채굴합니다. 시스템은 7단계 레벨(S0-S6), 온체인 추천 네트워크, Node NFT 보상 강화, 세금 훅이 포함된 Uniswap v4 자동 유동성 관리를 포함합니다.',
      '프로토콜은 완전 온체인 구조로 설계되어 중앙화된 자금 통제가 없습니다. 보상 계산, 레벨 판정, 분배 로직은 검증 가능한 스마트 컨트랙트로 실행됩니다.'
    ]
  },
  es: {
    overview: [
      'ETIM (Eternal Imprint) es un ecosistema descentralizado de participacion y mineria construido sobre Ethereum. Los usuarios depositan ETH para minar ETIM mediante un mecanismo de Growth Pool. El sistema incluye 7 niveles (S0-S6), red de referidos on-chain, Node NFTs y gestion automatizada de liquidez en Uniswap v4 con tax hook integrado.',
      'El protocolo esta disenado para funcionar totalmente on-chain sin control centralizado sobre los fondos. El calculo de recompensas, niveles y distribucion se ejecuta en contratos inteligentes verificables.'
    ]
  }
};

export default function WhitepaperPage() {
  const { t, locale } = useTranslation();
  const [activeArticle, setActiveArticle] = useState<ArticleId>('etim-whitepaper');

  const articles = ARTICLE_META[locale] ?? ARTICLE_META.en;
  const intro = INTRO_CONTENT[locale] ?? INTRO_CONTENT.en;
  const guide = GUIDE_CONTENT[locale] ?? GUIDE_CONTENT.en;
  const wpText = WHITEPAPER_TEXT[locale] ?? WHITEPAPER_TEXT.en;

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
      <div className="flex gap-8 lg:gap-12">
        <aside className="hidden lg:block w-72 shrink-0">
          <div className="sticky top-24 bg-gray-800/40 border border-gray-700/50 rounded-xl p-4">
            <h3 className="text-base font-semibold text-white mb-3">Articles</h3>
            <nav className="space-y-1.5">
              {articles.map((item) => {
                const active = item.id === activeArticle;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setActiveArticle(item.id)}
                    className={`w-full text-left rounded-md px-3 py-2 transition-colors ${
                      active ? 'bg-indigo-500/20 text-indigo-300 border border-indigo-400/40' : 'text-gray-300 hover:text-white hover:bg-gray-700/40 border border-transparent'
                    }`}
                  >
                    <div className="text-sm font-medium">{item.title}</div>
                    <div className="text-xs text-gray-400 mt-0.5">{item.subtitle}</div>
                  </button>
                );
              })}
            </nav>
          </div>
        </aside>

        <div className="flex-1 min-w-0">
          <div className="lg:hidden mb-6">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              {articles.map((item) => {
                const active = item.id === activeArticle;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setActiveArticle(item.id)}
                    className={`rounded-lg px-3 py-2 text-left border transition-colors ${
                      active ? 'bg-indigo-500/20 border-indigo-400/40 text-indigo-300' : 'bg-gray-800/40 border-gray-700/50 text-gray-300'
                    }`}
                  >
                    <div className="text-sm font-medium">{item.title}</div>
                    <div className="text-xs text-gray-400">{item.subtitle}</div>
                  </button>
                );
              })}
            </div>
          </div>

          {activeArticle === 'etim-whitepaper' && (
            <>
              <h1 className="text-3xl sm:text-4xl font-bold mb-2">{articles[0].title}</h1>
              <p className="text-gray-400 mb-12">{articles[0].subtitle}</p>

              <div className="prose prose-invert max-w-none space-y-12">
                <section>
                  <h2 className="text-2xl font-bold text-white mb-4">1. {t('wp.overview')}</h2>
                  <p className="text-gray-300 leading-relaxed">{wpText.overview[0]}</p>
                  <p className="text-gray-300 leading-relaxed mt-3">{wpText.overview[1]}</p>
                </section>

                <section>
                  <h2 className="text-2xl font-bold text-white mb-4">2. {t('wp.tokenEconomics')}</h2>
                  <p className="text-gray-300 leading-relaxed mb-4">
                    ETIM has a fixed total supply of <strong className="text-white">100,000,000 tokens</strong> with no inflation mechanism.
                  </p>
                  <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-6">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-gray-700 text-gray-400">
                          <th className="text-left py-2">Allocation</th>
                          <th className="text-right py-2">Amount</th>
                          <th className="text-right py-2">%</th>
                        </tr>
                      </thead>
                      <tbody className="text-gray-300">
                        <tr className="border-b border-gray-700/50"><td className="py-2">Growth Pool (Mining)</td><td className="text-right">87,700,000</td><td className="text-right">87.7%</td></tr>
                        <tr className="border-b border-gray-700/50"><td className="py-2">Market Infrastructure</td><td className="text-right">5,000,000</td><td className="text-right">5%</td></tr>
                        <tr className="border-b border-gray-700/50"><td className="py-2">Airdrop</td><td className="text-right">5,000,000</td><td className="text-right">5%</td></tr>
                        <tr className="border-b border-gray-700/50"><td className="py-2">Ecosystem Fund</td><td className="text-right">1,000,000</td><td className="text-right">1%</td></tr>
                        <tr className="border-b border-gray-700/50"><td className="py-2">Community Fund</td><td className="text-right">1,000,000</td><td className="text-right">1%</td></tr>
                        <tr><td className="py-2">Ethereum Foundation</td><td className="text-right">300,000</td><td className="text-right">0.3%</td></tr>
                      </tbody>
                    </table>
                  </div>
                </section>

                <section>
                  <h2 className="text-2xl font-bold text-white mb-4">3. {t('wp.miningMechanism')}</h2>
                  <p className="text-gray-300 leading-relaxed mb-3">
                    Users deposit <strong className="text-white">$100-$150</strong> worth of ETH (one-time per address) to enter the mining pool.
                  </p>
                  <ul className="list-disc list-inside text-gray-300 space-y-2">
                    <li>Base daily mining rate: 0.1% of principal USD value</li>
                    <li>Higher levels provide acceleration bonuses (up to +20% at S6)</li>
                    <li>Mining continues until the claimed USD value equals the invested USD value</li>
                    <li>Once the growth pool is depleted, Uniswap trading is unlocked</li>
                  </ul>
                  <h3 className="text-lg font-semibold text-white mt-6 mb-3">ETH Deposit Allocation</h3>
                  <ul className="list-disc list-inside text-gray-300 space-y-2">
                    <li><strong className="text-white">69%</strong> - Uniswap liquidity pool injection</li>
                    <li><strong className="text-white">25%</strong> - Token burn (sent to dead address)</li>
                    <li><strong className="text-white">2.5%</strong> - S2+ player ETH dividends</li>
                    <li><strong className="text-white">1.5%</strong> - Foundation rewards</li>
                    <li><strong className="text-white">1%</strong> - Node NFT holder rewards</li>
                    <li><strong className="text-white">1%</strong> - Pot and official rewards</li>
                  </ul>
                </section>

                <section>
                  <h2 className="text-2xl font-bold text-white mb-4">4. {t('wp.levelSystem')}</h2>
                  <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-6 overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-gray-700 text-gray-400">
                          <th className="text-left py-2">Level</th>
                          <th className="text-right py-2">Referrals</th>
                          <th className="text-right py-2">Personal</th>
                          <th className="text-right py-2">Team</th>
                          <th className="text-right py-2">Boost</th>
                        </tr>
                      </thead>
                      <tbody className="text-gray-300">
                        <tr className="border-b border-gray-700/50"><td className="py-2">S0</td><td className="text-right">0</td><td className="text-right">0</td><td className="text-right">0</td><td className="text-right text-green-400">+3%</td></tr>
                        <tr className="border-b border-gray-700/50"><td className="py-2">S1</td><td className="text-right">5</td><td className="text-right">50K</td><td className="text-right">500K</td><td className="text-right text-green-400">+7%</td></tr>
                        <tr className="border-b border-gray-700/50"><td className="py-2">S2</td><td className="text-right">10</td><td className="text-right">100K</td><td className="text-right">3M</td><td className="text-right text-green-400">+10%</td></tr>
                        <tr className="border-b border-gray-700/50"><td className="py-2">S3</td><td className="text-right">15</td><td className="text-right">150K</td><td className="text-right">5M</td><td className="text-right text-green-400">+12%</td></tr>
                        <tr className="border-b border-gray-700/50"><td className="py-2">S4</td><td className="text-right">20</td><td className="text-right">200K</td><td className="text-right">7M</td><td className="text-right text-green-400">+15%</td></tr>
                        <tr className="border-b border-gray-700/50"><td className="py-2">S5</td><td className="text-right">25</td><td className="text-right">300K</td><td className="text-right">9M</td><td className="text-right text-green-400">+18%</td></tr>
                        <tr><td className="py-2">S6</td><td className="text-right">30</td><td className="text-right">400K</td><td className="text-right">11M</td><td className="text-right text-green-400">+20%</td></tr>
                      </tbody>
                    </table>
                  </div>
                </section>

                <section>
                  <h2 className="text-2xl font-bold text-white mb-4">5. {t('wp.referralSystem')}</h2>
                  <ol className="list-decimal list-inside text-gray-300 space-y-2">
                    <li>User A (referrer) sends any amount of ETIM to User B</li>
                    <li>User B sends any amount of ETIM back to User A</li>
                    <li>This establishes A as B&apos;s referrer permanently on-chain</li>
                  </ol>
                </section>

                <section>
                  <h2 className="text-2xl font-bold text-white mb-4">6. {t('wp.nodeNfts')}</h2>
                  <ul className="list-disc list-inside text-gray-300 space-y-2">
                    <li>Maximum of <strong className="text-white">500 Node NFTs</strong>, each priced at $1,000</li>
                    <li>Each Node NFT provides 300M mining power units</li>
                    <li>1% of every ETH deposit is distributed to node holders proportionally</li>
                    <li>Requires S1 level activation to receive node rewards</li>
                  </ul>
                </section>

                <section>
                  <h2 className="text-2xl font-bold text-white mb-4">7. {t('wp.uniswapIntegration')}</h2>
                  <ul className="list-disc list-inside text-gray-300 space-y-2">
                    <li>Buy fee: 3% - Distributed to rewards pools</li>
                    <li>Sell fee: 3% - Distributed to rewards pools</li>
                    <li>69% of deposits automatically inject into Uniswap LP</li>
                    <li>25% of deposits used to buy and burn ETIM</li>
                    <li>Trading unlocks only after the growth pool is depleted</li>
                  </ul>
                </section>

                <section>
                  <h2 className="text-2xl font-bold text-white mb-4">8. {t('wp.smartContracts')}</h2>
                  <div className="bg-gray-800/50 border border-gray-700/50 rounded-xl p-6 space-y-3">
                    {Object.entries(CONTRACTS).map(([name, address]) => (
                      <div key={name} className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-3">
                        <span className="text-gray-400 text-sm w-36">{name}</span>
                        <a href={`https://etherscan.io/address/${address}`} target="_blank" rel="noopener noreferrer" className="text-indigo-400 hover:text-indigo-300 font-mono text-sm break-all">{address}</a>
                      </div>
                    ))}
                  </div>
                </section>
              </div>
            </>
          )}

          {activeArticle === 'depin-intro' && (
            <>
              <h1 className="text-3xl sm:text-4xl font-bold mb-2">{intro.title}</h1>
              <p className="text-gray-400 mb-12">{intro.subtitle}</p>

              <div className="prose prose-invert max-w-none space-y-10">
                {intro.sections.map((sec) => (
                  <section key={sec.id} id={sec.id}>
                    <h2 className="text-2xl font-bold text-white mb-4">{sec.title}</h2>
                    {sec.paragraphs.map((p, i) => (
                      <p key={i} className="text-gray-300 leading-relaxed mb-3">{p}</p>
                    ))}
                    {sec.bullets && sec.bullets.length > 0 && (
                      <ul className="list-disc list-inside text-gray-300 space-y-2">
                        {sec.bullets.map((b, i) => (
                          <li key={i}>{b}</li>
                        ))}
                      </ul>
                    )}
                  </section>
                ))}
              </div>
            </>
          )}

          {activeArticle === 'depin-guide' && (
            <>
              <h1 className="text-3xl sm:text-4xl font-bold mb-2">{guide.title}</h1>
              <p className="text-gray-400 mb-12">{guide.subtitle}</p>

              <div className="prose prose-invert max-w-none space-y-10">
                {guide.sections.map((sec) => (
                  <section key={sec.id} id={sec.id}>
                    <h2 className="text-2xl font-bold text-white mb-4">{sec.title}</h2>
                    {sec.paragraphs.map((p, i) => (
                      <p key={i} className="text-gray-300 leading-relaxed mb-3">{p}</p>
                    ))}
                    {sec.images && sec.images.length > 0 && (
                      <div className="mt-4 grid grid-cols-1 gap-4">
                        {sec.images.map((img, i) => (
                          <img
                            key={`${sec.id}-img-${i}`}
                            src={img.src}
                            alt={img.alt}
                            className="w-full max-w-3xl rounded-xl border border-gray-700/60 bg-gray-900/40"
                            loading="lazy"
                            onError={(e) => {
                              (e.currentTarget as HTMLImageElement).style.display = 'none';
                            }}
                          />
                        ))}
                      </div>
                    )}
                  </section>
                ))}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
