// Starter templates offered from the "New diagram" picker. Each is plain
// DBML, written to the same conventions as DEFAULT_DBML in app.js so every
// template also produces clean output through laravel-export.js /
// laravel-model-export.js / sql-export.js without any special-casing.

export const TEMPLATE_CATEGORIES = {
  full: 'Full-scale schemas',
};

export const TEMPLATES = [
  {
    id: 'blank',
    name: 'Blank',
    category: 'full',
    description: 'Start from an empty canvas.',
    dbml: '',
  },

  // ---------------- Full-scale schemas ----------------

  {
    id: 'blog',
    name: 'Blog',
    category: 'full',
    description: 'Posts, categories, comments, and tags.',
    dbml: `Table users {
  id int [pk, increment]
  name varchar
  email varchar [unique, not null]
  created_at timestamp
}

Table categories {
  id int [pk, increment]
  name varchar
  slug varchar [unique]
}

Table posts {
  id int [pk, increment]
  user_id int [not null]
  category_id int
  title varchar
  slug varchar [unique]
  body text
  published boolean [default: false]
  created_at timestamp
}

Table comments {
  id int [pk, increment]
  post_id int [not null]
  user_id int [not null]
  body text
  created_at timestamp
}

Table tags {
  id int [pk, increment]
  name varchar [unique]
}

Table post_tag {
  id int [pk, increment]
  post_id int [not null]
  tag_id int [not null]
}

Ref: posts.user_id > users.id
Ref: posts.category_id > categories.id
Ref: comments.post_id > posts.id
Ref: comments.user_id > users.id
Ref: post_tag.post_id > posts.id
Ref: post_tag.tag_id > tags.id
`,
  },

  {
    id: 'ecommerce',
    name: 'E-Commerce',
    category: 'full',
    description: 'Products, categories, orders, and order items.',
    dbml: `Table users {
  id int [pk, increment]
  name varchar
  email varchar [unique, not null]
  created_at timestamp
}

Table categories {
  id int [pk, increment]
  name varchar
  slug varchar [unique]
}

Table products {
  id int [pk, increment]
  category_id int
  name varchar
  description text
  price decimal(8,2)
  stock int [default: 0]
  created_at timestamp
}

Table orders {
  id int [pk, increment]
  user_id int [not null]
  status varchar [default: 'pending']
  total decimal(8,2)
  created_at timestamp
}

Table order_items {
  id int [pk, increment]
  order_id int [not null]
  product_id int [not null]
  quantity int [default: 1]
  price decimal(8,2)
}

Ref: products.category_id > categories.id
Ref: orders.user_id > users.id
Ref: order_items.order_id > orders.id
Ref: order_items.product_id > products.id
`,
  },

  {
    id: 'marketplace',
    name: 'Marketplace',
    category: 'full',
    description: 'Multi-vendor shops, products, orders, and reviews.',
    dbml: `Table users {
  id int [pk, increment]
  name varchar
  email varchar [unique, not null]
  created_at timestamp
}

Table shops {
  id int [pk, increment]
  user_id int [not null]
  name varchar
  slug varchar [unique]
  created_at timestamp
}

Table products {
  id int [pk, increment]
  shop_id int [not null]
  name varchar
  price decimal(8,2)
  stock int [default: 0]
}

Table orders {
  id int [pk, increment]
  user_id int [not null]
  product_id int [not null]
  quantity int [default: 1]
  status varchar [default: 'pending']
  created_at timestamp
}

Table reviews {
  id int [pk, increment]
  user_id int [not null]
  product_id int [not null]
  rating int
  body text
  created_at timestamp
}

Ref: shops.user_id > users.id
Ref: products.shop_id > shops.id
Ref: orders.user_id > users.id
Ref: orders.product_id > products.id
Ref: reviews.user_id > users.id
Ref: reviews.product_id > products.id
`,
  },

  {
    id: 'newsletter',
    name: 'Newsletter',
    category: 'full',
    description: 'Subscribers, campaigns, sends, and unsubscribes.',
    dbml: `Table users {
  id int [pk, increment]
  name varchar
  email varchar [unique, not null]
  created_at timestamp
}

Table subscribers {
  id int [pk, increment]
  email varchar [unique, not null]
  status varchar [default: 'active']
  subscribed_at timestamp
}

Table campaigns {
  id int [pk, increment]
  user_id int [not null]
  subject varchar
  body text
  sent_at timestamp
}

Table sends {
  id int [pk, increment]
  campaign_id int [not null]
  subscriber_id int [not null]
  opened boolean [default: false]
  sent_at timestamp
}

Table unsubscribes {
  id int [pk, increment]
  subscriber_id int [not null]
  campaign_id int
  unsubscribed_at timestamp
}

Ref: campaigns.user_id > users.id
Ref: sends.campaign_id > campaigns.id
Ref: sends.subscriber_id > subscribers.id
Ref: unsubscribes.subscriber_id > subscribers.id
Ref: unsubscribes.campaign_id > campaigns.id
`,
  },

  {
    id: 'auth-roles',
    name: 'Auth & Roles',
    category: 'full',
    description: 'Role-based access control with permissions.',
    dbml: `Table users {
  id int [pk, increment]
  name varchar
  email varchar [unique, not null]
  created_at timestamp
}

Table roles {
  id int [pk, increment]
  name varchar [unique]
}

Table permissions {
  id int [pk, increment]
  name varchar [unique]
}

Table role_user {
  id int [pk, increment]
  role_id int [not null]
  user_id int [not null]
}

Table permission_role {
  id int [pk, increment]
  permission_id int [not null]
  role_id int [not null]
}

Ref: role_user.role_id > roles.id
Ref: role_user.user_id > users.id
Ref: permission_role.permission_id > permissions.id
Ref: permission_role.role_id > roles.id
`,
  },

  {
    id: 'saas-starter',
    name: 'SaaS Starter',
    category: 'full',
    description: 'Multi-tenant teams, subscriptions, and invoices.',
    dbml: `Table users {
  id int [pk, increment]
  name varchar
  email varchar [unique, not null]
  created_at timestamp
}

Table teams {
  id int [pk, increment]
  owner_id int [not null]
  name varchar
  created_at timestamp
}

Table team_user {
  id int [pk, increment]
  team_id int [not null]
  user_id int [not null]
  role varchar [default: 'member']
}

Table subscriptions {
  id int [pk, increment]
  team_id int [not null]
  plan varchar
  status varchar [default: 'active']
  renews_at timestamp
}

Table invoices {
  id int [pk, increment]
  subscription_id int [not null]
  amount decimal(8,2)
  status varchar [default: 'paid']
  created_at timestamp
}

Ref: teams.owner_id > users.id
Ref: team_user.team_id > teams.id
Ref: team_user.user_id > users.id
Ref: subscriptions.team_id > teams.id
Ref: invoices.subscription_id > subscriptions.id
`,
  },

  {
    id: 'social-network',
    name: 'Social Network',
    category: 'full',
    description: 'Posts, comments, likes, follows, and notifications.',
    dbml: `Table users {
  id int [pk, increment]
  name varchar
  email varchar [unique, not null]
  avatar_url varchar
  created_at timestamp
}

Table posts {
  id int [pk, increment]
  user_id int [not null]
  body text
  created_at timestamp
}

Table comments {
  id int [pk, increment]
  post_id int [not null]
  user_id int [not null]
  body text
  created_at timestamp
}

Table likes {
  id int [pk, increment]
  user_id int [not null]
  post_id int [not null]
  created_at timestamp
}

Table follows {
  id int [pk, increment]
  follower_id int [not null]
  followee_id int [not null]
  created_at timestamp
}

Table notifications {
  id int [pk, increment]
  user_id int [not null]
  type varchar
  data json
  read boolean [default: false]
  created_at timestamp
}

Ref: posts.user_id > users.id
Ref: comments.post_id > posts.id
Ref: comments.user_id > users.id
Ref: likes.user_id > users.id
Ref: likes.post_id > posts.id
Ref: follows.follower_id > users.id
Ref: follows.followee_id > users.id
Ref: notifications.user_id > users.id
`,
  },

  {
    id: 'cms-starter',
    name: 'CMS Starter',
    category: 'full',
    description: 'Headless CMS with pages, sections, media, and menus.',
    dbml: `Table users {
  id int [pk, increment]
  name varchar
  email varchar [unique, not null]
  created_at timestamp
}

Table pages {
  id int [pk, increment]
  user_id int [not null]
  title varchar
  slug varchar [unique]
  status varchar [default: 'draft']
  created_at timestamp
}

Table sections {
  id int [pk, increment]
  page_id int [not null]
  type varchar
  content json
  position int [default: 0]
}

Table media {
  id int [pk, increment]
  user_id int [not null]
  file_path varchar
  mime_type varchar
  created_at timestamp
}

Table menus {
  id int [pk, increment]
  name varchar
  slug varchar [unique]
}

Table menu_items {
  id int [pk, increment]
  menu_id int [not null]
  page_id int
  label varchar
  position int [default: 0]
}

Table page_revisions {
  id int [pk, increment]
  page_id int [not null]
  user_id int [not null]
  content json
  created_at timestamp
}

Ref: pages.user_id > users.id
Ref: sections.page_id > pages.id
Ref: media.user_id > users.id
Ref: menu_items.menu_id > menus.id
Ref: menu_items.page_id > pages.id
Ref: page_revisions.page_id > pages.id
Ref: page_revisions.user_id > users.id
`,
  },

];

export function templatesByCategory() {
  const grouped = new Map();
  for (const key of Object.keys(TEMPLATE_CATEGORIES)) grouped.set(key, []);
  for (const t of TEMPLATES) {
    if (t.id === 'blank') continue;
    grouped.get(t.category).push(t);
  }
  return grouped;
}

export function templateStats(dbml) {
  const tables = (dbml.match(/^\s*Table\s+/gm) || []).length;
  const refs = (dbml.match(/^\s*Ref:/gm) || []).length;
  return { tables, refs };
}
