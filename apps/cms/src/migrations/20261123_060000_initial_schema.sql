-- WebCraft initial public-schema baseline. Payload's migration ledger is intentionally excluded.
CREATE TYPE public.enum_marketplace_favorites_kind AS ENUM (
    'component',
    'template'
);
CREATE TYPE public.enum_marketplace_packages_type AS ENUM (
    'component',
    'template'
);
CREATE TYPE public.enum_project_versions_reason AS ENUM (
    'automatic',
    'manual',
    'before-delete',
    'before-settings-change',
    'before-restore'
);
CREATE TYPE public.enum_projects_category AS ENUM (
    'Business',
    'Portfolio',
    'Agency',
    'SaaS',
    'E-commerce',
    'Education',
    'Blog',
    'Restaurant',
    'Landing Page',
    'Personal Website'
);
CREATE TABLE public.asset_folders (
    id integer NOT NULL,
    name character varying NOT NULL,
    project_id integer NOT NULL,
    owner_id integer NOT NULL,
    updated_at timestamp(3) with time zone DEFAULT now() NOT NULL,
    created_at timestamp(3) with time zone DEFAULT now() NOT NULL
);
CREATE SEQUENCE public.asset_folders_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
ALTER SEQUENCE public.asset_folders_id_seq OWNED BY public.asset_folders.id;
CREATE TABLE public.assets (
    id integer NOT NULL,
    name character varying,
    alt character varying,
    folder_id integer,
    project_id integer NOT NULL,
    owner_id integer NOT NULL,
    updated_at timestamp(3) with time zone DEFAULT now() NOT NULL,
    created_at timestamp(3) with time zone DEFAULT now() NOT NULL,
    url character varying,
    thumbnail_u_r_l character varying,
    filename character varying,
    mime_type character varying,
    filesize numeric,
    width numeric,
    height numeric,
    focal_x numeric,
    focal_y numeric,
    sizes_thumbnail_url character varying,
    sizes_thumbnail_width numeric,
    sizes_thumbnail_height numeric,
    sizes_thumbnail_mime_type character varying,
    sizes_thumbnail_filesize numeric,
    sizes_thumbnail_filename character varying
);
CREATE SEQUENCE public.assets_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
ALTER SEQUENCE public.assets_id_seq OWNED BY public.assets.id;
CREATE TABLE public.installed_components (
    id integer NOT NULL,
    name character varying NOT NULL,
    version character varying NOT NULL,
    project_id integer NOT NULL,
    source_package_id integer NOT NULL,
    components jsonb NOT NULL,
    owner_id integer NOT NULL,
    updated_at timestamp(3) with time zone DEFAULT now() NOT NULL,
    created_at timestamp(3) with time zone DEFAULT now() NOT NULL
);
CREATE SEQUENCE public.installed_components_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
ALTER SEQUENCE public.installed_components_id_seq OWNED BY public.installed_components.id;
CREATE TABLE public.marketplace_favorites (
    id integer NOT NULL,
    package_id character varying NOT NULL,
    kind public.enum_marketplace_favorites_kind NOT NULL,
    owner_id integer NOT NULL,
    updated_at timestamp(3) with time zone DEFAULT now() NOT NULL,
    created_at timestamp(3) with time zone DEFAULT now() NOT NULL
);
CREATE SEQUENCE public.marketplace_favorites_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
ALTER SEQUENCE public.marketplace_favorites_id_seq OWNED BY public.marketplace_favorites.id;
CREATE TABLE public.marketplace_packages (
    id integer NOT NULL,
    type public.enum_marketplace_packages_type NOT NULL,
    name character varying NOT NULL,
    description character varying,
    category character varying NOT NULL,
    version character varying NOT NULL,
    format_version numeric NOT NULL,
    published boolean DEFAULT false,
    package_data jsonb NOT NULL,
    owner_id integer NOT NULL,
    updated_at timestamp(3) with time zone DEFAULT now() NOT NULL,
    created_at timestamp(3) with time zone DEFAULT now() NOT NULL
);
CREATE SEQUENCE public.marketplace_packages_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
ALTER SEQUENCE public.marketplace_packages_id_seq OWNED BY public.marketplace_packages.id;
CREATE TABLE public.pages (
    id integer NOT NULL,
    title character varying NOT NULL,
    slug character varying NOT NULL,
    is_home boolean DEFAULT false,
    seo_title character varying,
    seo_description character varying,
    nodes jsonb DEFAULT '[]'::jsonb NOT NULL,
    undo_history jsonb DEFAULT '{"past": [], "future": []}'::jsonb,
    revision numeric DEFAULT 0,
    expected_revision numeric,
    project_id integer NOT NULL,
    owner_id integer NOT NULL,
    updated_at timestamp(3) with time zone DEFAULT now() NOT NULL,
    created_at timestamp(3) with time zone DEFAULT now() NOT NULL
);
CREATE SEQUENCE public.pages_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
ALTER SEQUENCE public.pages_id_seq OWNED BY public.pages.id;
CREATE TABLE public.payload_kv (
    id integer NOT NULL,
    key character varying NOT NULL,
    data jsonb NOT NULL
);
CREATE SEQUENCE public.payload_kv_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
ALTER SEQUENCE public.payload_kv_id_seq OWNED BY public.payload_kv.id;
CREATE TABLE public.payload_locked_documents (
    id integer NOT NULL,
    global_slug character varying,
    updated_at timestamp(3) with time zone DEFAULT now() NOT NULL,
    created_at timestamp(3) with time zone DEFAULT now() NOT NULL
);
CREATE SEQUENCE public.payload_locked_documents_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
ALTER SEQUENCE public.payload_locked_documents_id_seq OWNED BY public.payload_locked_documents.id;
CREATE TABLE public.payload_locked_documents_rels (
    id integer NOT NULL,
    "order" integer,
    parent_id integer NOT NULL,
    path character varying NOT NULL,
    users_id integer,
    projects_id integer,
    pages_id integer,
    asset_folders_id integer,
    assets_id integer,
    project_versions_id integer,
    marketplace_packages_id integer,
    marketplace_favorites_id integer,
    installed_components_id integer
);
CREATE SEQUENCE public.payload_locked_documents_rels_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
ALTER SEQUENCE public.payload_locked_documents_rels_id_seq OWNED BY public.payload_locked_documents_rels.id;
CREATE TABLE public.payload_preferences (
    id integer NOT NULL,
    key character varying,
    value jsonb,
    updated_at timestamp(3) with time zone DEFAULT now() NOT NULL,
    created_at timestamp(3) with time zone DEFAULT now() NOT NULL
);
CREATE SEQUENCE public.payload_preferences_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
ALTER SEQUENCE public.payload_preferences_id_seq OWNED BY public.payload_preferences.id;
CREATE TABLE public.payload_preferences_rels (
    id integer NOT NULL,
    "order" integer,
    parent_id integer NOT NULL,
    path character varying NOT NULL,
    users_id integer
);
CREATE SEQUENCE public.payload_preferences_rels_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
ALTER SEQUENCE public.payload_preferences_rels_id_seq OWNED BY public.payload_preferences_rels.id;
CREATE TABLE public.project_versions (
    id integer NOT NULL,
    project_id integer NOT NULL,
    owner_id integer NOT NULL,
    label character varying NOT NULL,
    reason public.enum_project_versions_reason NOT NULL,
    page_count numeric NOT NULL,
    content_hash character varying NOT NULL,
    fingerprint character varying NOT NULL,
    snapshot jsonb NOT NULL,
    updated_at timestamp(3) with time zone DEFAULT now() NOT NULL,
    created_at timestamp(3) with time zone DEFAULT now() NOT NULL
);
CREATE SEQUENCE public.project_versions_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
ALTER SEQUENCE public.project_versions_id_seq OWNED BY public.project_versions.id;
CREATE TABLE public.projects (
    id integer NOT NULL,
    name character varying NOT NULL,
    category public.enum_projects_category NOT NULL,
    template_id character varying NOT NULL,
    settings jsonb DEFAULT '{"title": "My website", "siteUrl": "", "language": "en", "logoPath": "", "customCss": "", "fontFamily": "Inter", "breakpoints": {"mobile": 600, "tablet": 900}, "description": "", "faviconPath": "", "primaryColor": "#5b5ce2", "customMetaTags": [], "structuredData": "", "socialImagePath": ""}'::jsonb NOT NULL,
    owner_id integer NOT NULL,
    updated_at timestamp(3) with time zone DEFAULT now() NOT NULL,
    created_at timestamp(3) with time zone DEFAULT now() NOT NULL
);
CREATE SEQUENCE public.projects_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
ALTER SEQUENCE public.projects_id_seq OWNED BY public.projects.id;
CREATE TABLE public.users (
    id integer NOT NULL,
    name character varying NOT NULL,
    updated_at timestamp(3) with time zone DEFAULT now() NOT NULL,
    created_at timestamp(3) with time zone DEFAULT now() NOT NULL,
    email character varying NOT NULL,
    reset_password_token character varying,
    reset_password_expiration timestamp(3) with time zone,
    salt character varying,
    hash character varying,
    reset_password_requested_at timestamp(3) with time zone,
    login_attempts numeric DEFAULT 0,
    lock_until timestamp(3) with time zone
);
CREATE SEQUENCE public.users_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
ALTER SEQUENCE public.users_id_seq OWNED BY public.users.id;
CREATE TABLE public.users_sessions (
    _order integer NOT NULL,
    _parent_id integer NOT NULL,
    id character varying NOT NULL,
    created_at timestamp(3) with time zone,
    expires_at timestamp(3) with time zone NOT NULL
);
ALTER TABLE ONLY public.asset_folders ALTER COLUMN id SET DEFAULT nextval('public.asset_folders_id_seq'::regclass);
ALTER TABLE ONLY public.assets ALTER COLUMN id SET DEFAULT nextval('public.assets_id_seq'::regclass);
ALTER TABLE ONLY public.installed_components ALTER COLUMN id SET DEFAULT nextval('public.installed_components_id_seq'::regclass);
ALTER TABLE ONLY public.marketplace_favorites ALTER COLUMN id SET DEFAULT nextval('public.marketplace_favorites_id_seq'::regclass);
ALTER TABLE ONLY public.marketplace_packages ALTER COLUMN id SET DEFAULT nextval('public.marketplace_packages_id_seq'::regclass);
ALTER TABLE ONLY public.pages ALTER COLUMN id SET DEFAULT nextval('public.pages_id_seq'::regclass);
ALTER TABLE ONLY public.payload_kv ALTER COLUMN id SET DEFAULT nextval('public.payload_kv_id_seq'::regclass);
ALTER TABLE ONLY public.payload_locked_documents ALTER COLUMN id SET DEFAULT nextval('public.payload_locked_documents_id_seq'::regclass);
ALTER TABLE ONLY public.payload_locked_documents_rels ALTER COLUMN id SET DEFAULT nextval('public.payload_locked_documents_rels_id_seq'::regclass);
ALTER TABLE ONLY public.payload_preferences ALTER COLUMN id SET DEFAULT nextval('public.payload_preferences_id_seq'::regclass);
ALTER TABLE ONLY public.payload_preferences_rels ALTER COLUMN id SET DEFAULT nextval('public.payload_preferences_rels_id_seq'::regclass);
ALTER TABLE ONLY public.project_versions ALTER COLUMN id SET DEFAULT nextval('public.project_versions_id_seq'::regclass);
ALTER TABLE ONLY public.projects ALTER COLUMN id SET DEFAULT nextval('public.projects_id_seq'::regclass);
ALTER TABLE ONLY public.users ALTER COLUMN id SET DEFAULT nextval('public.users_id_seq'::regclass);
ALTER TABLE ONLY public.asset_folders
    ADD CONSTRAINT asset_folders_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.assets
    ADD CONSTRAINT assets_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.installed_components
    ADD CONSTRAINT installed_components_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.marketplace_favorites
    ADD CONSTRAINT marketplace_favorites_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.marketplace_packages
    ADD CONSTRAINT marketplace_packages_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.pages
    ADD CONSTRAINT pages_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.payload_kv
    ADD CONSTRAINT payload_kv_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.payload_locked_documents
    ADD CONSTRAINT payload_locked_documents_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.payload_locked_documents_rels
    ADD CONSTRAINT payload_locked_documents_rels_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.payload_preferences
    ADD CONSTRAINT payload_preferences_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.payload_preferences_rels
    ADD CONSTRAINT payload_preferences_rels_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.project_versions
    ADD CONSTRAINT project_versions_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.projects
    ADD CONSTRAINT projects_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);
ALTER TABLE ONLY public.users_sessions
    ADD CONSTRAINT users_sessions_pkey PRIMARY KEY (id);
CREATE INDEX asset_folders_created_at_idx ON public.asset_folders USING btree (created_at);
CREATE INDEX asset_folders_owner_idx ON public.asset_folders USING btree (owner_id);
CREATE INDEX asset_folders_project_idx ON public.asset_folders USING btree (project_id);
CREATE INDEX asset_folders_updated_at_idx ON public.asset_folders USING btree (updated_at);
CREATE INDEX assets_created_at_idx ON public.assets USING btree (created_at);
CREATE UNIQUE INDEX assets_filename_idx ON public.assets USING btree (filename);
CREATE INDEX assets_folder_idx ON public.assets USING btree (folder_id);
CREATE INDEX assets_owner_idx ON public.assets USING btree (owner_id);
CREATE INDEX assets_project_idx ON public.assets USING btree (project_id);
CREATE INDEX assets_sizes_thumbnail_sizes_thumbnail_filename_idx ON public.assets USING btree (sizes_thumbnail_filename);
CREATE INDEX assets_updated_at_idx ON public.assets USING btree (updated_at);
CREATE INDEX installed_components_created_at_idx ON public.installed_components USING btree (created_at);
CREATE INDEX installed_components_owner_idx ON public.installed_components USING btree (owner_id);
CREATE INDEX installed_components_project_idx ON public.installed_components USING btree (project_id);
CREATE INDEX installed_components_source_package_idx ON public.installed_components USING btree (source_package_id);
CREATE INDEX installed_components_updated_at_idx ON public.installed_components USING btree (updated_at);
CREATE INDEX marketplace_favorites_created_at_idx ON public.marketplace_favorites USING btree (created_at);
CREATE INDEX marketplace_favorites_kind_idx ON public.marketplace_favorites USING btree (kind);
CREATE INDEX marketplace_favorites_owner_idx ON public.marketplace_favorites USING btree (owner_id);
CREATE INDEX marketplace_favorites_package_id_idx ON public.marketplace_favorites USING btree (package_id);
CREATE INDEX marketplace_favorites_updated_at_idx ON public.marketplace_favorites USING btree (updated_at);
CREATE INDEX marketplace_packages_category_idx ON public.marketplace_packages USING btree (category);
CREATE INDEX marketplace_packages_created_at_idx ON public.marketplace_packages USING btree (created_at);
CREATE INDEX marketplace_packages_name_idx ON public.marketplace_packages USING btree (name);
CREATE INDEX marketplace_packages_owner_idx ON public.marketplace_packages USING btree (owner_id);
CREATE INDEX marketplace_packages_published_idx ON public.marketplace_packages USING btree (published);
CREATE INDEX marketplace_packages_type_idx ON public.marketplace_packages USING btree (type);
CREATE INDEX marketplace_packages_updated_at_idx ON public.marketplace_packages USING btree (updated_at);
CREATE INDEX marketplace_packages_version_idx ON public.marketplace_packages USING btree (version);
CREATE UNIQUE INDEX "owner_packageId_idx" ON public.marketplace_favorites USING btree (owner_id, package_id);
CREATE UNIQUE INDEX "owner_project_sourcePackage_idx" ON public.installed_components USING btree (owner_id, project_id, source_package_id);
CREATE INDEX pages_created_at_idx ON public.pages USING btree (created_at);
CREATE INDEX pages_owner_idx ON public.pages USING btree (owner_id);
CREATE INDEX pages_project_idx ON public.pages USING btree (project_id);
CREATE INDEX pages_slug_idx ON public.pages USING btree (slug);
CREATE INDEX pages_updated_at_idx ON public.pages USING btree (updated_at);
CREATE UNIQUE INDEX payload_kv_key_idx ON public.payload_kv USING btree (key);
CREATE INDEX payload_locked_documents_created_at_idx ON public.payload_locked_documents USING btree (created_at);
CREATE INDEX payload_locked_documents_global_slug_idx ON public.payload_locked_documents USING btree (global_slug);
CREATE INDEX payload_locked_documents_rels_asset_folders_id_idx ON public.payload_locked_documents_rels USING btree (asset_folders_id);
CREATE INDEX payload_locked_documents_rels_assets_id_idx ON public.payload_locked_documents_rels USING btree (assets_id);
CREATE INDEX payload_locked_documents_rels_installed_components_id_idx ON public.payload_locked_documents_rels USING btree (installed_components_id);
CREATE INDEX payload_locked_documents_rels_marketplace_favorites_id_idx ON public.payload_locked_documents_rels USING btree (marketplace_favorites_id);
CREATE INDEX payload_locked_documents_rels_marketplace_packages_id_idx ON public.payload_locked_documents_rels USING btree (marketplace_packages_id);
CREATE INDEX payload_locked_documents_rels_order_idx ON public.payload_locked_documents_rels USING btree ("order");
CREATE INDEX payload_locked_documents_rels_pages_id_idx ON public.payload_locked_documents_rels USING btree (pages_id);
CREATE INDEX payload_locked_documents_rels_parent_idx ON public.payload_locked_documents_rels USING btree (parent_id);
CREATE INDEX payload_locked_documents_rels_path_idx ON public.payload_locked_documents_rels USING btree (path);
CREATE INDEX payload_locked_documents_rels_project_versions_id_idx ON public.payload_locked_documents_rels USING btree (project_versions_id);
CREATE INDEX payload_locked_documents_rels_projects_id_idx ON public.payload_locked_documents_rels USING btree (projects_id);
CREATE INDEX payload_locked_documents_rels_users_id_idx ON public.payload_locked_documents_rels USING btree (users_id);
CREATE INDEX payload_locked_documents_updated_at_idx ON public.payload_locked_documents USING btree (updated_at);
CREATE INDEX payload_preferences_created_at_idx ON public.payload_preferences USING btree (created_at);
CREATE INDEX payload_preferences_key_idx ON public.payload_preferences USING btree (key);
CREATE INDEX payload_preferences_rels_order_idx ON public.payload_preferences_rels USING btree ("order");
CREATE INDEX payload_preferences_rels_parent_idx ON public.payload_preferences_rels USING btree (parent_id);
CREATE INDEX payload_preferences_rels_path_idx ON public.payload_preferences_rels USING btree (path);
CREATE INDEX payload_preferences_rels_users_id_idx ON public.payload_preferences_rels USING btree (users_id);
CREATE INDEX payload_preferences_updated_at_idx ON public.payload_preferences USING btree (updated_at);
CREATE INDEX project_versions_content_hash_idx ON public.project_versions USING btree (content_hash);
CREATE INDEX project_versions_created_at_idx ON public.project_versions USING btree (created_at);
CREATE UNIQUE INDEX project_versions_fingerprint_idx ON public.project_versions USING btree (fingerprint);
CREATE INDEX project_versions_owner_idx ON public.project_versions USING btree (owner_id);
CREATE INDEX project_versions_project_idx ON public.project_versions USING btree (project_id);
CREATE INDEX project_versions_updated_at_idx ON public.project_versions USING btree (updated_at);
CREATE INDEX projects_created_at_idx ON public.projects USING btree (created_at);
CREATE INDEX projects_name_idx ON public.projects USING btree (name);
CREATE INDEX projects_owner_idx ON public.projects USING btree (owner_id);
CREATE INDEX projects_updated_at_idx ON public.projects USING btree (updated_at);
CREATE INDEX users_created_at_idx ON public.users USING btree (created_at);
CREATE UNIQUE INDEX users_email_idx ON public.users USING btree (email);
CREATE INDEX users_sessions_order_idx ON public.users_sessions USING btree (_order);
CREATE INDEX users_sessions_parent_id_idx ON public.users_sessions USING btree (_parent_id);
CREATE INDEX users_updated_at_idx ON public.users USING btree (updated_at);
CREATE UNIQUE INDEX webcraft_asset_folders_project_name_ci_uidx ON public.asset_folders USING btree (project_id, lower((name)::text));
CREATE UNIQUE INDEX webcraft_pages_one_homepage_uidx ON public.pages USING btree (project_id) WHERE (is_home IS TRUE);
CREATE UNIQUE INDEX webcraft_pages_project_slug_uidx ON public.pages USING btree (project_id, slug);
ALTER TABLE ONLY public.asset_folders
    ADD CONSTRAINT asset_folders_owner_id_users_id_fk FOREIGN KEY (owner_id) REFERENCES public.users(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.asset_folders
    ADD CONSTRAINT asset_folders_project_id_projects_id_fk FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.assets
    ADD CONSTRAINT assets_folder_id_asset_folders_id_fk FOREIGN KEY (folder_id) REFERENCES public.asset_folders(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.assets
    ADD CONSTRAINT assets_owner_id_users_id_fk FOREIGN KEY (owner_id) REFERENCES public.users(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.assets
    ADD CONSTRAINT assets_project_id_projects_id_fk FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.installed_components
    ADD CONSTRAINT installed_components_owner_id_users_id_fk FOREIGN KEY (owner_id) REFERENCES public.users(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.installed_components
    ADD CONSTRAINT installed_components_project_id_projects_id_fk FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.installed_components
    ADD CONSTRAINT installed_components_source_package_id_marketplace__b150ef67_fk FOREIGN KEY (source_package_id) REFERENCES public.marketplace_packages(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.marketplace_favorites
    ADD CONSTRAINT marketplace_favorites_owner_id_users_id_fk FOREIGN KEY (owner_id) REFERENCES public.users(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.marketplace_packages
    ADD CONSTRAINT marketplace_packages_owner_id_users_id_fk FOREIGN KEY (owner_id) REFERENCES public.users(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.pages
    ADD CONSTRAINT pages_owner_id_users_id_fk FOREIGN KEY (owner_id) REFERENCES public.users(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.pages
    ADD CONSTRAINT pages_project_id_projects_id_fk FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.payload_locked_documents_rels
    ADD CONSTRAINT payload_locked_documents_rels_asset_folders_fk FOREIGN KEY (asset_folders_id) REFERENCES public.asset_folders(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.payload_locked_documents_rels
    ADD CONSTRAINT payload_locked_documents_rels_assets_fk FOREIGN KEY (assets_id) REFERENCES public.assets(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.payload_locked_documents_rels
    ADD CONSTRAINT payload_locked_documents_rels_installed_components_fk FOREIGN KEY (installed_components_id) REFERENCES public.installed_components(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.payload_locked_documents_rels
    ADD CONSTRAINT payload_locked_documents_rels_marketplace_favorites_fk FOREIGN KEY (marketplace_favorites_id) REFERENCES public.marketplace_favorites(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.payload_locked_documents_rels
    ADD CONSTRAINT payload_locked_documents_rels_marketplace_packages_fk FOREIGN KEY (marketplace_packages_id) REFERENCES public.marketplace_packages(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.payload_locked_documents_rels
    ADD CONSTRAINT payload_locked_documents_rels_pages_fk FOREIGN KEY (pages_id) REFERENCES public.pages(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.payload_locked_documents_rels
    ADD CONSTRAINT payload_locked_documents_rels_parent_fk FOREIGN KEY (parent_id) REFERENCES public.payload_locked_documents(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.payload_locked_documents_rels
    ADD CONSTRAINT payload_locked_documents_rels_project_versions_fk FOREIGN KEY (project_versions_id) REFERENCES public.project_versions(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.payload_locked_documents_rels
    ADD CONSTRAINT payload_locked_documents_rels_projects_fk FOREIGN KEY (projects_id) REFERENCES public.projects(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.payload_locked_documents_rels
    ADD CONSTRAINT payload_locked_documents_rels_users_fk FOREIGN KEY (users_id) REFERENCES public.users(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.payload_preferences_rels
    ADD CONSTRAINT payload_preferences_rels_parent_fk FOREIGN KEY (parent_id) REFERENCES public.payload_preferences(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.payload_preferences_rels
    ADD CONSTRAINT payload_preferences_rels_users_fk FOREIGN KEY (users_id) REFERENCES public.users(id) ON DELETE CASCADE;
ALTER TABLE ONLY public.project_versions
    ADD CONSTRAINT project_versions_owner_id_users_id_fk FOREIGN KEY (owner_id) REFERENCES public.users(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.project_versions
    ADD CONSTRAINT project_versions_project_id_projects_id_fk FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.projects
    ADD CONSTRAINT projects_owner_id_users_id_fk FOREIGN KEY (owner_id) REFERENCES public.users(id) ON DELETE SET NULL;
ALTER TABLE ONLY public.users_sessions
    ADD CONSTRAINT users_sessions_parent_id_fk FOREIGN KEY (_parent_id) REFERENCES public.users(id) ON DELETE CASCADE;
