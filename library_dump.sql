--
-- PostgreSQL database dump
--

\restrict o3Lpg89oCIwPhTcjLbQapf3Z4ykmKI54kVB3BcTBXtu0xr5GBeYWBzIyIWv0PjO

-- Dumped from database version 18.3
-- Dumped by pg_dump version 18.3

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: sync_book_download_metrics(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.sync_book_download_metrics() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  UPDATE books SET download_count = download_count + 1 WHERE id = NEW.book_id;
  RETURN NEW;
END;
$$;


--
-- Name: sync_user_registration_trends(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE FUNCTION public.sync_user_registration_trends() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
  INSERT INTO monthly_account_stats (year_val, month_name, account_count)
  VALUES (EXTRACT(YEAR FROM NOW())::INTEGER, TO_CHAR(NOW(), 'Mon'), 1)
  ON CONFLICT (year_val, month_name) DO UPDATE SET account_count = monthly_account_stats.account_count + 1;
  RETURN NEW;
END;
$$;


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: approval_requests; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.approval_requests (
    id integer NOT NULL,
    request_code character varying(20) NOT NULL,
    action character varying(50) NOT NULL,
    target_label character varying(500) NOT NULL,
    target_book_id integer,
    reason text,
    stage character varying(20) DEFAULT 'checker'::character varying NOT NULL,
    requested_by integer NOT NULL,
    checker_id integer,
    authorizer_id integer,
    reject_reason text,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL,
    request_type character varying(20) DEFAULT 'download'::character varying,
    requested_permission character varying(20),
    officer_id integer,
    officer_reject_reason text,
    senior_officer_reject_reason text,
    dept_head_reject_reason text,
    maker_full_name character varying(255),
    maker_username character varying(100),
    meta_context jsonb,
    document_class character varying(20) DEFAULT 'normal'::character varying,
    security_class character varying(20),
    required_stages text[],
    fee_per_page numeric(10,2),
    page_count_snapshot integer,
    total_fee numeric(10,2),
    payment_status character varying(20) DEFAULT 'unpaid'::character varying,
    assigned_reviewer_id integer,
    CONSTRAINT approval_requests_request_type_check CHECK (((request_type)::text = ANY ((ARRAY['download'::character varying, 'permission'::character varying])::text[]))),
    CONSTRAINT approval_requests_requested_permission_check CHECK (((requested_permission)::text = ANY ((ARRAY['add'::character varying, 'edit'::character varying, 'delete'::character varying, NULL::character varying])::text[]))),
    CONSTRAINT approval_requests_stage_check CHECK (((stage)::text = ANY ((ARRAY['officer'::character varying, 'senior_officer'::character varying, 'authorizer'::character varying, 'approved'::character varying, 'rejected'::character varying, 'checker'::character varying])::text[]))),
    CONSTRAINT chk_authorizer_not_maker CHECK (((authorizer_id IS NULL) OR (authorizer_id <> requested_by))),
    CONSTRAINT chk_checker_not_maker CHECK (((checker_id IS NULL) OR (checker_id <> requested_by)))
);


--
-- Name: approval_requests_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.approval_requests_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: approval_requests_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.approval_requests_id_seq OWNED BY public.approval_requests.id;


--
-- Name: audit_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.audit_logs (
    id integer NOT NULL,
    user_id integer,
    action character varying(100) NOT NULL,
    detail text NOT NULL,
    severity character varying(20) DEFAULT 'info'::character varying NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    CONSTRAINT audit_logs_severity_check CHECK (((severity)::text = ANY ((ARRAY['success'::character varying, 'warning'::character varying, 'danger'::character varying, 'info'::character varying])::text[])))
);


--
-- Name: audit_logs_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.audit_logs_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: audit_logs_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.audit_logs_id_seq OWNED BY public.audit_logs.id;


--
-- Name: books; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.books (
    id integer NOT NULL,
    title text NOT NULL,
    author text NOT NULL,
    department text,
    location text,
    published_year integer,
    file_path text,
    page_count integer DEFAULT 12,
    uploaded_by integer,
    download_count integer DEFAULT 0 NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone DEFAULT now() NOT NULL,
    category character varying(40),
    report_topic character varying(120),
    map_type character varying(40),
    map_format character varying(20),
    scale character varying(20),
    document_class character varying(20) DEFAULT 'normal'::character varying,
    security_class character varying(20) DEFAULT 'normal'::character varying,
    CONSTRAINT books_document_class_check CHECK (((document_class)::text = ANY ((ARRAY['normal'::character varying, 'medium_restriction'::character varying, 'strict'::character varying])::text[]))),
    CONSTRAINT books_security_class_check CHECK (((security_class)::text = ANY ((ARRAY['normal'::character varying, 'medium'::character varying, 'strict'::character varying])::text[])))
);


--
-- Name: books_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.books_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: books_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.books_id_seq OWNED BY public.books.id;


--
-- Name: download_logs; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.download_logs (
    id integer NOT NULL,
    book_id integer NOT NULL,
    user_id integer,
    downloaded_at timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: download_logs_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.download_logs_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: download_logs_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.download_logs_id_seq OWNED BY public.download_logs.id;


--
-- Name: monthly_account_stats; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.monthly_account_stats (
    id integer NOT NULL,
    year_val integer NOT NULL,
    month_name character varying(10) NOT NULL,
    account_count integer DEFAULT 0 NOT NULL
);


--
-- Name: monthly_account_stats_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.monthly_account_stats_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: monthly_account_stats_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.monthly_account_stats_id_seq OWNED BY public.monthly_account_stats.id;


--
-- Name: notifications; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.notifications (
    id integer NOT NULL,
    user_id integer NOT NULL,
    message text NOT NULL,
    link character varying(300),
    is_read boolean DEFAULT false NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    title character varying(150),
    request_id integer
);


--
-- Name: notifications_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.notifications_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: notifications_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.notifications_id_seq OWNED BY public.notifications.id;


--
-- Name: password_resets; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.password_resets (
    id integer NOT NULL,
    user_id integer NOT NULL,
    token character varying(255) NOT NULL,
    is_used boolean DEFAULT false NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL
);


--
-- Name: password_resets_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.password_resets_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: password_resets_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.password_resets_id_seq OWNED BY public.password_resets.id;


--
-- Name: payments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.payments (
    id integer NOT NULL,
    user_id integer NOT NULL,
    book_id integer,
    approval_request_id integer,
    price_per_page numeric(10,2) NOT NULL,
    free_preview_pages integer DEFAULT 5 NOT NULL,
    page_count integer NOT NULL,
    total_amount numeric(10,2) NOT NULL,
    status character varying(20) DEFAULT 'pending'::character varying NOT NULL,
    payment_reference character varying(120),
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    updated_at timestamp without time zone,
    request_id integer,
    fee_per_page numeric(10,2),
    gateway character varying(50)
);


--
-- Name: payments_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.payments_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: payments_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.payments_id_seq OWNED BY public.payments.id;


--
-- Name: role_permissions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.role_permissions (
    role_name character varying(50) NOT NULL,
    can_view boolean DEFAULT false,
    can_edit boolean DEFAULT false,
    can_delete boolean DEFAULT false,
    can_download boolean DEFAULT false,
    updated_at timestamp without time zone DEFAULT now()
);


--
-- Name: roles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.roles (
    id integer NOT NULL,
    role_name character varying(50) NOT NULL,
    responsibility character varying(50) DEFAULT 'None'::character varying NOT NULL,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    CONSTRAINT roles_responsibility_check CHECK (((responsibility)::text = ANY ((ARRAY['Maker'::character varying, 'Checker'::character varying, 'Authorizer'::character varying, 'None'::character varying])::text[])))
);


--
-- Name: roles_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.roles_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: roles_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.roles_id_seq OWNED BY public.roles.id;


--
-- Name: system_settings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.system_settings (
    setting_key character varying(255) NOT NULL,
    config_data jsonb NOT NULL,
    updated_at timestamp without time zone DEFAULT now()
);


--
-- Name: tasks; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tasks (
    id integer NOT NULL,
    document_title text NOT NULL,
    sender_id integer,
    approver_id integer,
    status text DEFAULT 'Pending'::text
);


--
-- Name: tasks_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.tasks_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: tasks_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.tasks_id_seq OWNED BY public.tasks.id;


--
-- Name: users; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.users (
    id integer NOT NULL,
    username character varying(100) NOT NULL,
    email character varying(255) NOT NULL,
    password_hash character varying(255) NOT NULL,
    role_id integer,
    department character varying(150),
    status character varying(20) DEFAULT 'Active'::character varying NOT NULL,
    last_active_at timestamp without time zone,
    created_at timestamp without time zone DEFAULT now() NOT NULL,
    "firstName" character varying(100),
    "middleName" character varying(100),
    "lastName" character varying(100),
    role character varying(50) DEFAULT 'user'::character varying,
    full_name character varying(255),
    CONSTRAINT users_status_check CHECK (((status)::text = ANY ((ARRAY['Active'::character varying, 'Inactive'::character varying])::text[])))
);


--
-- Name: users_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.users_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: users_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.users_id_seq OWNED BY public.users.id;


--
-- Name: approval_requests id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.approval_requests ALTER COLUMN id SET DEFAULT nextval('public.approval_requests_id_seq'::regclass);


--
-- Name: audit_logs id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_logs ALTER COLUMN id SET DEFAULT nextval('public.audit_logs_id_seq'::regclass);


--
-- Name: books id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.books ALTER COLUMN id SET DEFAULT nextval('public.books_id_seq'::regclass);


--
-- Name: download_logs id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.download_logs ALTER COLUMN id SET DEFAULT nextval('public.download_logs_id_seq'::regclass);


--
-- Name: monthly_account_stats id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.monthly_account_stats ALTER COLUMN id SET DEFAULT nextval('public.monthly_account_stats_id_seq'::regclass);


--
-- Name: notifications id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notifications ALTER COLUMN id SET DEFAULT nextval('public.notifications_id_seq'::regclass);


--
-- Name: password_resets id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.password_resets ALTER COLUMN id SET DEFAULT nextval('public.password_resets_id_seq'::regclass);


--
-- Name: payments id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payments ALTER COLUMN id SET DEFAULT nextval('public.payments_id_seq'::regclass);


--
-- Name: roles id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.roles ALTER COLUMN id SET DEFAULT nextval('public.roles_id_seq'::regclass);


--
-- Name: tasks id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tasks ALTER COLUMN id SET DEFAULT nextval('public.tasks_id_seq'::regclass);


--
-- Name: users id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users ALTER COLUMN id SET DEFAULT nextval('public.users_id_seq'::regclass);


--
-- Data for Name: approval_requests; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.approval_requests (id, request_code, action, target_label, target_book_id, reason, stage, requested_by, checker_id, authorizer_id, reject_reason, created_at, updated_at, request_type, requested_permission, officer_id, officer_reject_reason, senior_officer_reject_reason, dept_head_reject_reason, maker_full_name, maker_username, meta_context, document_class, security_class, required_stages, fee_per_page, page_count_snapshot, total_fee, payment_status, assigned_reviewer_id) FROM stdin;
1	REQ-2026-011	Permission: edit	Sample Book Title	\N	Updating book metadata details	rejected	1	\N	\N	i dont like tt	2026-06-23 00:58:08.682984	2026-06-23 01:32:33.2195	permission	\N	\N	\N	i dont like tt	\N	Samuel Wubie	samcode	\N	normal	\N	\N	\N	\N	\N	unpaid	\N
4	REQ-2028	Download	Download Document: Survey of Ethiopia	1	it is for research purpose	rejected	2	\N	\N	\N	2026-06-24 10:41:12.252754	2026-06-25 01:08:29.199859	download	download	2	AS	\N	\N	\N	Sami_wubie	{"bookId": 1, "filePath": "abebe kebede.pdf"}	normal	\N	\N	\N	\N	\N	unpaid	\N
6	REQ-2030	Permission: edit	Update Record: Short fictions	3	Former given publication year was incorrect.	approved	2	3	9	\N	2026-07-12 05:08:07.449344	2026-07-12 05:10:25.787018	permission	edit	\N	\N	\N	\N	\N	Sami_wubie	{"title": "Short fictions", "author": "Alemayehu Gelagay", "location": "bahirdar", "targetId": 3, "isEditing": true, "department": "Novel", "published_year": "2030"}	normal	\N	\N	\N	\N	\N	unpaid	\N
5	REQ-2029	Permission: edit	Update Record: Survey of Ethiopia	1	ASDFGHNJ	rejected	2	3	9	\N	2026-06-25 01:01:42.863774	2026-07-12 05:12:29.18284	permission	edit	\N	\N	\N	I check the document from junior officer so the given data is't enough to edit.	\N	Sami_wubie	{"title": "Survey of Ethiopia", "author": "abebe kebede", "location": "addis ababa", "targetId": 1, "isEditing": true, "department": "Geology", "published_year": "2025"}	normal	\N	\N	\N	\N	\N	unpaid	\N
3	REQ-2027	Download	Download Document: Fikir eske mekabir	2	qaswdssaf	rejected	2	\N	\N	\N	2026-06-24 07:29:56.885958	2026-07-12 06:12:15.347104	download	download	1	12	\N	\N	\N	Sami_wubie	{"bookId": 2, "filePath": "addis alemayehu.pdf"}	normal	\N	\N	\N	\N	\N	unpaid	\N
8	REQ-2032	Download	Download Document: Survey of Ethiopia	1	Standard document — no authorization required	approved	1	\N	\N	\N	2026-07-15 07:51:42.341736	2026-07-15 07:51:42.341736	download	\N	\N	\N	\N	\N	\N	admin	{"file_path": "abebe kebede.pdf"}	normal	normal	{}	2.00	12	24.00	unpaid	\N
9	REQ-2033	Download	Download Document: Dirtogada	10	Standard document — no authorization required	approved	1	\N	\N	\N	2026-07-15 15:02:17.254552	2026-07-15 15:02:17.254552	download	\N	\N	\N	\N	\N	\N	admin	{"file_path": "yismake worku.pdf"}	normal	normal	{}	2.00	12	24.00	unpaid	\N
12	REQ-2036	Permission: add	Create New Record: Industrial Mineral Resource Evaluation in the Amhara Region	\N	Upload files start	approved	2	3	9	\N	2026-07-16 11:36:46.023544	2026-07-16 11:38:53.241114	permission	add	\N	\N	\N	\N	\N	Sami_wubie	{"scale": null, "title": "Industrial Mineral Resource Evaluation in the Amhara Region", "author": "Alem Kebede", "mapType": null, "category": "technical_report", "location": "Gondar", "targetId": null, "file_path": "1784227005960-alem-kebede.pdf", "isEditing": false, "mapFormat": null, "department": "Geology", "reportTopic": "001 Abrasives (Pumice)", "published_year": "1985"}	normal	\N	\N	\N	\N	\N	unpaid	\N
11	REQ-2035	Permission: add	Create New Record: Mapping Artisanal Gold Mining Sectors Using Remote Sensing	\N	upload file start	approved	2	3	9	\N	2026-07-16 11:35:32.836362	2026-07-16 11:38:55.744256	permission	add	\N	\N	\N	\N	\N	Sami_wubie	{"scale": null, "title": "Mapping Artisanal Gold Mining Sectors Using Remote Sensing", "author": "Addis Alemayehu", "mapType": null, "category": "technical_report", "location": "Addis Ababa", "targetId": null, "file_path": "1784226932639-addis-alemayehu.pdf", "isEditing": false, "mapFormat": null, "department": "Geoscience", "reportTopic": "001 Abrasives (Pumice)", "published_year": "2002"}	normal	\N	\N	\N	\N	\N	unpaid	\N
10	REQ-2034	Permission: add	Create New Record: Rare Earth Element Potential in Southern Ethiopia	\N	upload file start	approved	2	3	9	\N	2026-07-16 11:33:53.985677	2026-07-16 11:38:57.473614	permission	add	\N	\N	\N	\N	\N	Sami_wubie	{"scale": null, "title": "Rare Earth Element Potential in Southern Ethiopia", "author": "Abebe Kebede", "mapType": null, "category": "technical_report", "location": "Hawassa", "targetId": null, "file_path": "1784226833825-abebe-kebede.pdf", "isEditing": false, "mapFormat": null, "department": "Geology", "reportTopic": "001 Abrasives (Pumice)", "published_year": "1998"}	normal	\N	\N	\N	\N	\N	unpaid	\N
7	REQ-2031	Permission: download	Download Document: Survey of Ethiopia	1	love	approved	11	3	9	\N	2026-07-12 13:25:21.320818	2026-07-16 11:39:01.573302	download	download	2	\N	\N	\N	alem kebede lema	Alem.kebede	{"bookId": 1, "filePath": "abebe kebede.pdf"}	normal	\N	\N	\N	\N	\N	unpaid	\N
15	REQ-2039	Permission: add	Create New Record: maps of ethiopia	\N	shapfile is stored	approved	2	3	9	\N	2026-07-16 13:05:51.78486	2026-07-16 13:07:24.244359	permission	add	\N	\N	\N	\N	\N	Sami_wubie	{"scale": "1:50,000", "title": "maps of ethiopia", "author": "Ayalew denberu", "mapType": "geological", "category": "map", "location": "Gondar", "targetId": null, "file_path": "1784232351541-building-management-system.zip", "isEditing": false, "mapFormat": "shapefile", "department": "Geology", "reportTopic": null, "published_year": "2021"}	normal	\N	\N	\N	\N	\N	unpaid	\N
14	REQ-2038	Permission: add	Create New Record: Hydrogeological Mapping of the Nile Basin Headwaters	\N	Uploades documents are start	approved	2	3	9	\N	2026-07-16 13:01:59.927972	2026-07-16 13:07:25.703295	permission	add	\N	\N	\N	\N	\N	Sami_wubie	{"scale": null, "title": "Hydrogeological Mapping of the Nile Basin Headwaters", "author": "Bealu Girma", "mapType": null, "category": "technical_report", "location": "Gondar", "targetId": null, "file_path": "1784232119772-bealu-girma.pdf", "isEditing": false, "mapFormat": null, "department": "Hydrogeology", "reportTopic": "001 Abrasives (Pumice)", "published_year": "2001"}	normal	\N	\N	\N	\N	\N	unpaid	\N
13	REQ-2037	Permission: add	Create New Record: Gemstone Deposits of Ethiopia: A Geological Overview	\N	upload document is start	approved	2	3	9	\N	2026-07-16 12:54:30.471417	2026-07-16 13:07:27.587767	permission	add	\N	\N	\N	\N	\N	Sami_wubie	{"scale": null, "title": "Gemstone Deposits of Ethiopia: A Geological Overview", "author": "Alemayehu Gelagay", "mapType": null, "category": "technical_report", "location": "Addis Ababa", "targetId": null, "file_path": "1784231670424-alemayehu-gelagay.pdf", "isEditing": false, "mapFormat": null, "department": "Geology", "reportTopic": "001 Abrasives (Pumice)", "published_year": "2001"}	normal	\N	\N	\N	\N	\N	unpaid	\N
16	REQ-2040	Download	Download Document: Industrial Mineral Resource Evaluation in the Amhara Region	36	Standard document — no authorization required	approved	1	\N	\N	\N	2026-07-17 10:19:54.09226	2026-07-17 10:19:54.09226	download	\N	\N	\N	\N	\N	\N	admin	{"file_path": "1784227005960-alem-kebede.pdf"}	normal	normal	{}	2.00	12	24.00	unpaid	\N
17	REQ-2041	Download	Download Document: Industrial Mineral Resource Evaluation in the Amhara Region	36	One note: the "Officer" role here is whatever role is assigned to the officer stage in your admin Access Control responsibility map (default "Officer"), so it keeps working if you rename roles there.	approved	2	3	\N	\N	2026-07-17 10:57:06.720745	2026-07-17 10:58:17.724824	download	\N	\N	\N	\N	\N	\N	Sami_wubie	{"file_path": "1784227005960-alem-kebede.pdf"}	normal	normal	{senior_officer}	0.00	12	0.00	paid	\N
18	REQ-2042	Download	Download Document: Mapping Artisanal Gold Mining Sectors Using Remote Sensing	37	sdfghjk	rejected	2	3	\N	\N	2026-07-17 11:09:48.327674	2026-07-17 11:10:34.252272	download	\N	\N	\N	asdfghjkl	\N	\N	Sami_wubie	{"file_path": "1784226932639-addis-alemayehu.pdf"}	normal	normal	{senior_officer}	0.00	12	0.00	paid	\N
19	REQ-2043	Permission: add	Create New Record: Seismic Monitoring Networks of the Ethiopian Geoscience Institute	\N	We want to add foles to Kaolin Beslesa	approved	2	3	9	\N	2026-07-17 11:25:57.769724	2026-07-17 12:37:37.892401	permission	add	\N	\N	\N	\N	\N	Sami_wubie	{"scale": null, "title": "Seismic Monitoring Networks of the Ethiopian Geoscience Institute", "author": "Soliyan Demoz", "mapType": null, "category": "technical_report", "location": "Addis Ababa", "targetId": null, "file_path": "1784312757681-zz.pdf", "isEditing": false, "mapFormat": null, "department": "Geophysics", "reportTopic": "002 Kaolin Belesa Feldspar, Quartz", "published_year": "2001"}	normal	\N	\N	\N	\N	\N	unpaid	\N
21	REQ-2045	Permission: edit	Update Record: Seismic Monitoring Networks of the Ethiopian Geoscience Institute	42	The published year was incorrect.	rejected	2	10	\N	\N	2026-07-18 02:20:01.058066	2026-07-18 02:39:02.742538	permission	edit	\N	\N	B/C i checked the original document so It was corrected when they upload.	\N	\N	Sami_wubie	{"scale": null, "title": "Seismic Monitoring Networks of the Ethiopian Geoscience Institute", "author": "Soliyan Demoz", "mapType": null, "category": "technical_report", "location": "Addis Ababa", "targetId": 42, "isEditing": true, "mapFormat": null, "department": "Geophysics", "reportTopic": "002 Kaolin Belesa Feldspar, Quartz", "published_year": "2002"}	normal	\N	\N	\N	\N	\N	unpaid	\N
22	REQ-2046	Permission: edit	Update Record: Industrial Mineral Resource Evaluation in the Amhara Region	36	I need it	authorizer	2	10	\N	\N	2026-07-18 02:36:23.600781	2026-07-18 02:39:08.81464	permission	edit	\N	\N	\N	\N	\N	Sami_wubie	{"scale": null, "title": "Industrial Mineral Resource Evaluation in the Amhara Region", "author": "Alem Kebede", "mapType": null, "category": "technical_report", "location": "Gondar", "targetId": 36, "isEditing": true, "mapFormat": null, "department": "Geology", "reportTopic": "001 Abrasives (Pumice)", "published_year": "198"}	normal	\N	\N	\N	\N	\N	unpaid	10
20	REQ-2044	Download	Download Document: Seismic Monitoring Networks of the Ethiopian Geoscience Institute	42	I want to this document for research purposes.	approved	2	3	\N	\N	2026-07-18 02:14:24.677307	2026-07-18 02:41:08.126069	download	\N	\N	\N	\N	\N	\N	Sami_wubie	{"file_path": "1784312757681-zz.pdf"}	normal	normal	{senior_officer}	0.00	12	0.00	paid	\N
23	REQ-2047	Permission: edit	Update Record: Mapping Artisanal Gold Mining Sectors Using Remote Sensing	37	ertghjk,l./.,mnbvbnm,.	authorizer	2	3	\N	\N	2026-07-18 02:52:42.961868	2026-07-18 02:53:16.529797	permission	edit	\N	\N	\N	\N	\N	Sami_wubie	{"scale": null, "title": "Mapping Artisanal Gold Mining Sectors Using Remote Sensing", "author": "Addis Alemayehu", "mapType": null, "category": "technical_report", "location": "Addis Ababa", "targetId": 37, "isEditing": true, "mapFormat": null, "department": "Geoscience", "reportTopic": "001 Abrasives (Pumice)", "published_year": "2006"}	normal	\N	\N	\N	\N	\N	unpaid	11
24	REQ-2048	Permission: add	Create New Record: Geological History of Ethiopia	\N	It's new resource about Ethiopia Geology	rejected	2	10	9	\N	2026-07-18 12:35:08.434814	2026-07-18 12:41:59.187227	permission	add	\N	\N	\N	I don't like it	\N	Sami_wubie	{"scale": null, "title": "Geological History of Ethiopia", "author": "Oytisa Gis", "mapType": null, "category": "technical_report", "location": "Hawassa", "targetId": null, "file_path": "1784403308349-efrata-melku.pdf", "isEditing": false, "mapFormat": null, "department": "Geophysics", "reportTopic": "001 Abrasives (Pumice)", "published_year": "2011"}	normal	\N	\N	\N	\N	\N	unpaid	9
25	REQ-2049	Permission: add	Create New Record: Land slide	\N	I want to do it	senior_officer	2	\N	\N	\N	2026-07-18 14:57:16.508477	2026-07-18 14:57:16.508477	permission	add	\N	\N	\N	\N	\N	Sami_wubie	{"scale": null, "title": "Land slide", "author": "Dejene Alebachew", "mapType": null, "category": "technical_report", "location": "Dessie", "targetId": null, "file_path": "1784411836503-bitanita-amanuel.pdf", "isEditing": false, "mapFormat": null, "department": "Geohazard", "reportTopic": "001 Abrasives (Pumice)", "published_year": "2010"}	normal	\N	\N	\N	\N	\N	unpaid	10
\.


--
-- Data for Name: audit_logs; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.audit_logs (id, user_id, action, detail, severity, created_at) FROM stdin;
1	1	Login	User authenticated successfully	info	2026-06-18 12:25:26.576634
2	1	Login	User authenticated successfully	info	2026-06-18 12:26:05.353529
3	1	Login	User authenticated successfully	info	2026-06-18 12:33:13.217552
4	1	Login	User authenticated successfully	info	2026-06-18 12:39:20.43043
5	1	Login	User authenticated successfully	info	2026-06-18 13:08:10.459509
6	1	Login	User authenticated successfully	info	2026-06-18 13:09:34.207403
7	1	Login	User authenticated successfully	info	2026-06-18 13:17:19.722868
8	1	Login	User authenticated successfully	info	2026-06-18 13:19:18.813454
9	1	Login	User authenticated successfully	info	2026-06-18 13:27:14.645522
10	1	Login	User authenticated successfully	info	2026-06-18 13:27:56.942536
11	1	Login	User authenticated successfully	info	2026-06-18 13:37:29.945599
12	1	Login	User authenticated successfully	info	2026-06-18 13:41:45.982453
13	1	Login	User authenticated successfully	info	2026-06-18 13:54:42.955493
14	1	Login	User authenticated successfully	info	2026-06-18 14:37:14.093244
15	1	Login	User authenticated successfully	info	2026-06-18 14:47:01.672405
16	1	Login	User authenticated successfully	info	2026-06-18 14:53:17.354363
17	1	Login	User authenticated successfully	info	2026-06-18 14:58:33.921109
18	\N	Matrix Update	Modified runtime authorization boundaries matrix configurations.	danger	2026-06-18 14:58:46.353602
19	\N	Matrix Update	Modified runtime authorization boundaries matrix configurations.	danger	2026-06-18 14:58:47.060658
20	\N	Matrix Update	Modified runtime authorization boundaries matrix configurations.	danger	2026-06-18 14:58:48.280292
21	\N	Matrix Update	Modified runtime authorization boundaries matrix configurations.	danger	2026-06-18 14:58:49.016135
22	1	Login	User authenticated successfully	info	2026-06-18 15:11:15.96301
23	1	Login	User authenticated successfully	info	2026-06-18 15:15:53.528166
24	1	Login	User authenticated successfully	info	2026-06-19 22:47:44.70846
25	1	Login	admin signed in	info	2026-06-20 00:35:10.052206
26	2	Account created	New self-registered account: Sami_wubie (User)	info	2026-06-20 00:37:14.467418
27	2	Login	Sami_wubie signed in	info	2026-06-20 00:37:42.084149
28	1	Login	admin signed in	info	2026-06-20 00:51:37.043222
29	1	Login	admin signed in	info	2026-06-20 01:32:27.068463
30	1	Login	admin signed in	info	2026-06-20 01:46:46.339054
31	2	Login	Sami_wubie signed in	info	2026-06-20 01:51:30.545264
32	1	Login	admin signed in	info	2026-06-20 01:54:28.225998
33	1	Login	admin signed in	info	2026-06-20 10:51:46.291911
34	\N	Created	Added record: Geospatial Report	info	2026-06-20 10:55:26.321463
35	2	Password reset	Sami_wubie reset their password	warning	2026-06-20 10:57:31.269869
36	2	Login	Sami_wubie signed in	info	2026-06-20 10:57:55.778202
37	3	Account created	New self-registered account: Elisu@Demoz (User)	info	2026-06-20 11:01:53.134301
38	3	Login	Elisu@Demoz signed in	info	2026-06-20 11:03:12.742542
39	1	Login	admin signed in	info	2026-06-20 11:04:06.146824
40	1	Login	admin signed in	info	2026-06-20 13:40:39.241614
41	1	Login	admin signed in	info	2026-06-20 13:47:50.35254
42	1	Login	admin signed in	info	2026-06-20 13:49:04.754614
43	1	Role changed	Sami_wubie role changed to Officer	warning	2026-06-20 13:50:31.180197
44	1	Role changed	Sami_wubie role changed to User	warning	2026-06-20 13:50:42.823203
45	1	Login	admin signed in	info	2026-06-20 13:51:45.453895
46	9	Account created	New self-registered account: basa@sami (User)	info	2026-06-20 14:02:09.515401
47	1	Login	admin signed in	info	2026-06-20 14:02:24.602263
48	1	Role changed	Elisu@Demoz role changed to Senior Officer	warning	2026-06-20 14:06:24.799951
49	1	Login	admin signed in	info	2026-06-21 04:18:32.980504
50	1	Login	admin signed in	info	2026-06-21 04:36:21.812854
51	1	Login	admin signed in	info	2026-06-21 05:06:44.025501
52	1	Role changed	Sami_wubie role changed to Officer	warning	2026-06-21 07:27:59.719465
53	2	Login	Sami_wubie signed in	info	2026-06-21 07:28:49.628171
54	1	Login	admin signed in	info	2026-06-21 07:29:40.386718
55	1	Matrix updated	Access control permission matrix changed	warning	2026-06-21 07:30:17.349107
56	2	Login	Sami_wubie signed in	info	2026-06-21 07:44:58.911053
57	1	Login	admin signed in	info	2026-06-21 07:45:39.50369
58	1	Role changed	Sami_wubie role changed to Senior Officer	warning	2026-06-21 07:45:53.173506
59	2	Login	Sami_wubie signed in	info	2026-06-21 07:46:22.456443
60	1	Login	admin signed in	info	2026-06-21 10:19:45.339168
61	2	Login	Sami_wubie signed in	info	2026-06-21 10:20:31.620959
62	1	Login	admin signed in	info	2026-06-21 12:09:06.013702
63	1	Role changed	Sami_wubie role changed to Officer	warning	2026-06-21 12:09:34.668806
64	1	Logout	admin signed out	info	2026-06-21 12:10:18.665034
65	2	Login	Sami_wubie signed in	info	2026-06-21 12:10:49.600816
66	2	Logout	Sami_wubie signed out	info	2026-06-21 13:13:09.771303
67	1	Login	admin signed in	info	2026-06-21 13:13:12.908355
68	\N	Downloaded	Survey of Ethiopia	info	2026-06-21 13:14:25.029175
69	1	Logout	admin signed out	info	2026-06-21 13:16:00.780214
70	3	Password reset	Elisu@Demoz reset their password	warning	2026-06-21 13:16:37.173616
71	3	Login	Elisu@Demoz signed in	info	2026-06-21 13:16:53.00791
72	\N	Downloaded	Survey of Ethiopia	info	2026-06-21 13:17:11.522058
73	\N	Downloaded	Survey of Ethiopia	info	2026-06-21 13:26:03.135888
74	\N	Downloaded	Ethiopian Resources	info	2026-06-21 13:29:34.142028
75	\N	Downloaded	Survey of Ethiopia	info	2026-06-21 13:32:54.459655
76	3	Logout	Elisu@Demoz signed out	info	2026-06-21 13:33:22.614405
77	1	Login	admin signed in	info	2026-06-21 13:33:24.824528
78	\N	Downloaded	Dirtogada	info	2026-06-21 13:59:09.768938
79	1	Logout	admin signed out	info	2026-06-21 14:14:43.33553
80	2	Login	Sami_wubie signed in	info	2026-06-21 14:15:12.520463
81	2	Logout	Sami_wubie signed out	info	2026-06-21 14:16:09.083134
82	1	Login	admin signed in	info	2026-06-21 14:16:31.293303
83	1	Logout	admin signed out	info	2026-06-22 00:40:43.57172
84	2	Login	Sami_wubie signed in	info	2026-06-22 00:41:22.050773
85	\N	Edited	Updated record: Survey of Ethiopia	info	2026-06-22 00:41:54.562688
86	2	Logout	Sami_wubie signed out	info	2026-06-22 00:42:18.870125
87	1	Login	admin signed in	info	2026-06-22 00:42:25.310615
88	1	Matrix updated	Access control permission matrix changed	warning	2026-06-22 00:42:44.659696
89	1	Matrix updated	Access control permission matrix changed	warning	2026-06-22 00:43:23.614203
90	1	Matrix updated	Access control permission matrix changed	warning	2026-06-22 00:43:54.206984
91	1	Matrix updated	Access control permission matrix changed	warning	2026-06-22 00:44:07.223219
92	1	Matrix updated	Access control permission matrix changed	warning	2026-06-22 00:44:09.978588
93	1	Logout	admin signed out	info	2026-06-22 01:06:28.051829
94	9	Password reset	basa@sami reset their password	warning	2026-06-22 01:07:07.537479
95	9	Login	basa@sami signed in	info	2026-06-22 01:07:22.449179
96	1	Matrix updated	Access control permission matrix changed	warning	2026-06-22 01:07:45.353687
97	9	Logout	basa@sami signed out	info	2026-06-22 04:10:21.89655
98	1	Login	admin signed in	info	2026-06-22 04:10:25.368079
99	1	Logout	admin signed out	info	2026-06-22 06:54:56.317014
100	2	Login	Sami_wubie signed in	info	2026-06-22 06:55:15.89233
101	2	Logout	Sami_wubie signed out	info	2026-06-22 06:55:33.311411
102	1	Login	admin signed in	info	2026-06-22 06:55:35.355097
103	1	Matrix updated	Access control permission matrix changed	warning	2026-06-22 06:55:51.205843
104	2	Logout	Sami_wubie signed out	info	2026-06-22 06:57:54.460351
105	3	Login	Elisu@Demoz signed in	info	2026-06-22 06:58:05.380402
134	3	Logout	Elisu@Demoz signed out	info	2026-06-22 19:16:26.264931
135	2	Login	Sami_wubie signed in	info	2026-06-22 19:17:16.279902
136	2	Logout	Sami_wubie signed out	info	2026-06-23 01:04:42.287008
137	1	Login	admin signed in	info	2026-06-23 01:04:47.765172
138	1	Logout	admin signed out	info	2026-06-23 01:05:09.123942
139	3	Login	Elisu@Demoz signed in	info	2026-06-23 01:05:34.176523
140	3	Rejected	Rejected REQ-2026-011 (Senior Officer step) — i dont like tt	danger	2026-06-23 01:32:33.224323
141	3	Logout	Elisu@Demoz signed out	info	2026-06-23 01:44:20.191773
142	2	Login	Sami_wubie signed in	info	2026-06-23 01:44:39.958086
143	1	Role changed	basa@sami role changed to Department Head	warning	2026-06-23 01:58:50.090936
144	2	Logout	Sami_wubie signed out	info	2026-06-23 12:08:08.281
145	1	Login	admin signed in	info	2026-06-23 12:08:10.286838
146	1	Role changed	Sami_wubie role changed to Senior Officer	warning	2026-06-24 04:39:06.974297
147	1	Logout	admin signed out	info	2026-06-24 04:39:16.400255
148	2	Login	Sami_wubie signed in	info	2026-06-24 04:39:54.609679
149	2	Logout	Sami_wubie signed out	info	2026-06-24 06:23:31.604386
150	1	Login	admin signed in	info	2026-06-24 06:23:33.837729
151	1	Downloaded	Short fictions	info	2026-06-24 06:34:20.654013
152	1	Role changed	admin role changed to Senior Officer	warning	2026-06-24 06:55:33.460266
153	1	Role changed	admin role changed to User	warning	2026-06-24 06:55:56.495774
154	1	Logout	admin signed out	info	2026-06-24 06:56:08.388151
155	2	Login	Sami_wubie signed in	info	2026-06-24 06:56:41.07399
156	1	Role changed	Sami_wubie role changed to Officer	warning	2026-06-24 06:57:32.595543
157	2	Logout	Sami_wubie signed out	info	2026-06-24 06:58:17.955909
158	1	Login	admin signed in	info	2026-06-24 06:58:19.719262
159	1	Logout	admin signed out	info	2026-06-24 07:29:17.464937
160	2	Login	Sami_wubie signed in	info	2026-06-24 07:29:36.428761
161	2	Requested	Submitted REQ-2027 — Download: Download Document: Fikir eske mekabir via routing stage [officer]	warning	2026-06-24 07:29:56.892214
162	1	Logout	admin signed out	info	2026-06-24 07:30:40.310345
163	3	Login	Elisu@Demoz signed in	info	2026-06-24 07:30:49.178523
164	3	Logout	Elisu@Demoz signed out	info	2026-06-24 09:01:57.688402
165	9	Password reset	basa@sami reset their password	warning	2026-06-24 09:06:37.957876
166	1	Login	admin signed in	info	2026-06-24 09:07:13.710667
167	1	Logout	admin signed out	info	2026-06-24 09:12:14.1466
168	2	Login	Sami_wubie signed in	info	2026-06-24 09:12:39.233426
169	2	Logout	Sami_wubie signed out	info	2026-06-24 09:13:22.751494
170	9	Login	basa@sami signed in	info	2026-06-24 09:13:42.366731
171	9	Logout	basa@sami signed out	info	2026-06-24 09:14:40.490389
172	3	Login	Elisu@Demoz signed in	info	2026-06-24 09:14:55.340331
173	3	Logout	Elisu@Demoz signed out	info	2026-06-24 09:15:21.491971
174	1	Login	admin signed in	info	2026-06-24 09:15:23.238862
175	1	Logout	admin signed out	info	2026-06-24 09:17:07.192747
176	2	Login	Sami_wubie signed in	info	2026-06-24 09:17:28.662369
177	2	Requested	Submitted REQ-2028 — Download: Download Document: Survey of Ethiopia via routing stage [officer]	warning	2026-06-24 10:41:12.269789
178	2	Logout	Sami_wubie signed out	info	2026-06-24 10:41:42.793512
179	1	Login	admin signed in	info	2026-06-24 10:41:45.494178
180	1	Logout	admin signed out	info	2026-06-24 10:42:26.011741
181	3	Login	Elisu@Demoz signed in	info	2026-06-24 10:42:39.262967
182	3	Logout	Elisu@Demoz signed out	info	2026-06-24 11:13:21.12443
183	1	Login	admin signed in	info	2026-06-24 11:13:23.496371
184	1	Logout	admin signed out	info	2026-06-24 11:15:54.275718
185	1	Login	admin signed in	info	2026-06-24 11:17:17.764618
186	2	Login	Sami_wubie signed in	info	2026-06-24 11:18:16.553643
187	1	Logout	admin signed out	info	2026-06-24 11:39:02.907612
188	10	Account created	New self-registered account: yoha@abebe (User)	info	2026-06-24 11:50:35.073243
189	1	Login	admin signed in	info	2026-06-24 12:19:47.091319
190	3	Logout	Elisu@Demoz signed out	info	2026-06-24 12:22:08.679493
191	11	Account created	New self-registered account: Alem.kebede (User)	info	2026-06-24 12:23:06.189124
192	1	Login	admin signed in	info	2026-06-24 12:32:11.42972
193	1	Login	admin signed in	info	2026-06-24 14:38:21.4095
194	1	Role changed	yoha@abebe role changed to Officer	warning	2026-06-24 14:42:12.200328
195	1	Logout	admin signed out	info	2026-06-24 14:42:49.051152
196	3	Login	Elisu@Demoz signed in	info	2026-06-24 14:43:07.292397
197	1	Login	admin signed in	info	2026-06-24 14:47:02.49533
198	1	Security Matrix Saved	Updated the global role access permissions matrix	danger	2026-06-24 14:51:32.175113
199	1	Security Matrix Saved	Updated the global role access permissions matrix	danger	2026-06-24 14:51:35.554526
200	1	Security Matrix Saved	Updated the global role access permissions matrix	danger	2026-06-24 14:52:09.285171
201	1	Security Matrix Saved	Updated the global role access permissions matrix	danger	2026-06-24 14:52:13.652548
202	1	Security Matrix Saved	Updated the global role access permissions matrix	danger	2026-06-24 14:52:15.119272
203	1	Security Matrix Saved	Updated the global role access permissions matrix	danger	2026-06-24 14:52:17.474342
204	1	Security Matrix Saved	Updated the global role access permissions matrix	danger	2026-06-24 14:52:38.78076
205	1	Security Matrix Saved	Updated the global role access permissions matrix	danger	2026-06-24 14:52:47.552586
206	1	Security Matrix Saved	Updated the global role access permissions matrix	danger	2026-06-24 14:52:48.669849
207	1	Security Matrix Saved	Updated the global role access permissions matrix	danger	2026-06-24 14:52:50.499995
208	1	Security Matrix Saved	Updated the global role access permissions matrix	danger	2026-06-24 14:53:53.082972
209	1	Security Matrix Saved	Updated the global role access permissions matrix	danger	2026-06-24 14:53:54.921
210	2	Login	Sami_wubie signed in	info	2026-06-24 14:54:20.399655
211	2	Logout	Sami_wubie signed out	info	2026-06-24 14:56:34.444179
212	1	Login	admin signed in	info	2026-06-24 14:56:36.148115
213	1	Security Matrix Saved	Updated the global role access permissions matrix	danger	2026-06-24 14:58:12.841345
214	1	Security Matrix Saved	Updated the global role access permissions matrix	danger	2026-06-24 14:58:16.129685
215	1	Security Matrix Saved	Updated the global role access permissions matrix	danger	2026-06-24 14:58:17.563271
216	1	Security Matrix Saved	Updated the global role access permissions matrix	danger	2026-06-24 15:01:43.740772
217	1	Workflow Responsibility Saved	Updated the dynamic routing chain layout mapping structure	danger	2026-06-25 00:33:58.312196
218	1	Workflow Responsibility Saved	Updated the dynamic routing chain layout mapping structure	danger	2026-06-25 00:34:29.638882
219	2	Requested	Submitted REQ-2029 — Permission: edit: Update Record: Survey of Ethiopia via routing stage [senior_officer]	warning	2026-06-25 01:01:42.875763
220	2	Office Request Rejected	Request REQ-2028 rejected at stage 'officer'	danger	2026-06-25 01:08:29.20939
221	1	Security Matrix Saved	Updated the global role access permissions matrix layout configuration blueprint	danger	2026-07-10 10:52:27.329799
222	1	Security Matrix Saved	Updated the global role access permissions matrix layout configuration blueprint	danger	2026-07-10 10:52:28.005503
223	1	Logout	admin signed out	info	2026-07-11 17:03:15.022381
224	1	Login	admin signed in	info	2026-07-11 17:03:55.086679
225	1	Logout	admin signed out	info	2026-07-11 17:04:29.571586
226	2	Login	Sami_wubie signed in	info	2026-07-11 17:04:47.174808
227	2	Logout	Sami_wubie signed out	info	2026-07-12 02:36:46.547341
228	1	Login	admin signed in	info	2026-07-12 02:36:48.268023
229	1	Workflow Responsibility Saved	Updated the dynamic routing chain layout mapping structure	danger	2026-07-12 03:11:12.386061
230	1	Workflow Responsibility Saved	Updated the dynamic routing chain layout mapping structure	danger	2026-07-12 03:11:25.035653
231	1	Security Matrix Saved	Updated the global role access permissions matrix layout configuration blueprint	danger	2026-07-12 03:11:52.686439
232	1	Security Matrix Saved	Updated the global role access permissions matrix layout configuration blueprint	danger	2026-07-12 03:11:56.652368
233	1	Logout	admin signed out	info	2026-07-12 03:28:32.603928
234	1	Login	admin signed in	info	2026-07-12 03:33:17.751009
235	12	Account created	New self-registered account: Teddy@shanbel (User)	info	2026-07-12 05:04:29.214264
236	1	Login	admin signed in	info	2026-07-12 05:04:38.263528
237	1	Logout	admin signed out	info	2026-07-12 05:05:17.677354
238	2	Login	Sami_wubie signed in	info	2026-07-12 05:05:39.621835
239	2	Requested	Submitted REQ-2030 — Permission: edit: Update Record: Short fictions via routing stage [senior_officer]	warning	2026-07-12 05:08:07.462505
240	2	Logout	Sami_wubie signed out	info	2026-07-12 05:08:18.634885
241	3	Login	Elisu@Demoz signed in	info	2026-07-12 05:08:38.04351
242	3	Office Chain: Senior Officer Verified	Request REQ-2030 advanced from 'senior_officer' to 'authorizer'	info	2026-07-12 05:08:54.178785
243	3	Office Chain: Senior Officer Verified	Request REQ-2029 advanced from 'senior_officer' to 'authorizer'	info	2026-07-12 05:09:01.694135
244	3	Logout	Elisu@Demoz signed out	info	2026-07-12 05:09:11.867002
245	1	Login	admin signed in	info	2026-07-12 05:09:13.489458
246	1	Logout	admin signed out	info	2026-07-12 05:10:02.132188
247	9	Login	basa@sami signed in	info	2026-07-12 05:10:12.812377
248	9	Office Chain: Department Head Verified	Request REQ-2030 advanced from 'authorizer' to 'approved'	info	2026-07-12 05:10:25.793227
249	2	Execution Complete	Staging modification metrics updated successfully for action: edit	success	2026-07-12 05:10:25.804012
250	9	Office Request Rejected	Request REQ-2029 rejected at stage 'authorizer'	danger	2026-07-12 05:12:29.195381
251	9	Logout	basa@sami signed out	info	2026-07-12 06:11:06.226553
252	1	Login	admin signed in	info	2026-07-12 06:11:15.620825
253	1	Office Request Rejected	Request REQ-2027 rejected at stage 'officer'	danger	2026-07-12 06:12:15.352191
254	1	Security Matrix Saved	Updated the global role access permissions matrix layout configuration blueprint	danger	2026-07-12 06:14:09.609472
255	1	Security Matrix Saved	Updated the global role access permissions matrix layout configuration blueprint	danger	2026-07-12 06:14:18.318244
256	1	Logout	admin signed out	info	2026-07-12 06:14:47.454317
257	2	Login	Sami_wubie signed in	info	2026-07-12 06:15:12.79751
258	2	Logout	Sami_wubie signed out	info	2026-07-12 06:15:32.930347
259	1	Login	admin signed in	info	2026-07-12 06:15:34.573182
260	1	Logout	admin signed out	info	2026-07-12 13:22:43.63952
261	11	Login	Alem.kebede signed in	info	2026-07-12 13:22:55.568318
262	11	Logout	Alem.kebede signed out	info	2026-07-12 13:24:35.044114
263	1	Login	admin signed in	info	2026-07-12 13:24:36.525004
264	1	Security Matrix Saved	Updated the global role access permissions matrix layout configuration blueprint	danger	2026-07-12 13:24:41.588294
265	1	Logout	admin signed out	info	2026-07-12 13:24:48.950551
266	11	Login	Alem.kebede signed in	info	2026-07-12 13:25:00.690376
267	11	Requested	Submitted REQ-2031 — Permission: download: Download Document: Survey of Ethiopia via routing stage [officer]	warning	2026-07-12 13:25:21.327069
268	11	Logout	Alem.kebede signed out	info	2026-07-12 13:33:28.83639
269	1	Login	admin signed in	info	2026-07-12 13:33:32.099769
270	1	Logout	admin signed out	info	2026-07-12 13:33:56.511895
271	2	Login	Sami_wubie signed in	info	2026-07-12 13:34:09.252522
272	2	Logout	Sami_wubie signed out	info	2026-07-15 07:44:21.700294
273	1	Login	admin signed in	info	2026-07-15 07:44:23.916445
274	1	Security Matrix Saved	Updated the global role access permissions matrix layout configuration blueprint	danger	2026-07-15 07:44:30.545727
275	1	Download Requested	REQ-2032 — Survey of Ethiopia (normal, no approval needed)	info	2026-07-15 07:51:42.351432
276	1	Security Matrix Saved	Updated the global role access permissions matrix layout configuration blueprint	danger	2026-07-15 07:52:11.846808
277	1	Class Fees Updated	Per-page fees set — Normal: 2, Medium: 4.5, Strict: 10	warning	2026-07-15 07:55:30.455837
278	1	Logout	admin signed out	info	2026-07-15 07:56:21.521548
279	2	Login	Sami_wubie signed in	info	2026-07-15 07:56:41.038798
280	2	Office Chain: Officer Verified	Request REQ-2031 advanced from 'officer' to 'senior_officer'	info	2026-07-15 07:57:02.855711
281	2	Logout	Sami_wubie signed out	info	2026-07-15 07:59:51.417235
282	3	Login	Elisu@Demoz signed in	info	2026-07-15 08:00:21.665683
283	3	Office Chain: Senior Officer Verified	Request REQ-2031 advanced from 'senior_officer' to 'authorizer'	info	2026-07-15 08:00:42.440948
284	3	Logout	Elisu@Demoz signed out	info	2026-07-15 12:12:01.909814
285	1	Login	admin signed in	info	2026-07-15 12:23:36.283272
286	1	Logout	admin signed out	info	2026-07-15 12:32:41.377447
287	1	Login	admin signed in	info	2026-07-15 12:43:57.238996
288	1	Logout	admin signed out	info	2026-07-15 12:58:43.429344
289	1	Login	admin signed in	info	2026-07-15 14:41:34.129836
290	1	Logout	admin signed out	info	2026-07-15 15:01:20.93483
291	1	Login	admin signed in	info	2026-07-15 15:01:23.521795
292	1	Download Requested	REQ-2033 — Dirtogada (normal, no approval needed)	info	2026-07-15 15:02:17.266846
293	1	Logout	admin signed out	info	2026-07-16 11:01:41.559938
294	2	Login	Sami_wubie signed in	info	2026-07-16 11:01:55.655402
295	2	Logout	Sami_wubie signed out	info	2026-07-16 11:04:44.34092
296	1	Login	admin signed in	info	2026-07-16 11:04:47.016695
297	1	Logout	admin signed out	info	2026-07-16 11:05:24.55247
298	3	Login	Elisu@Demoz signed in	info	2026-07-16 11:05:40.789662
299	3	Logout	Elisu@Demoz signed out	info	2026-07-16 11:31:19.302739
300	2	Login	Sami_wubie signed in	info	2026-07-16 11:31:35.661046
301	2	Requested	Submitted REQ-2034 — Permission: add: Create New Record: Rare Earth Element Potential in Southern Ethiopia via routing stage [senior_officer]	warning	2026-07-16 11:33:53.993411
302	2	Requested	Submitted REQ-2035 — Permission: add: Create New Record: Mapping Artisanal Gold Mining Sectors Using Remote Sensing via routing stage [senior_officer]	warning	2026-07-16 11:35:32.841533
303	2	Requested	Submitted REQ-2036 — Permission: add: Create New Record: Industrial Mineral Resource Evaluation in the Amhara Region via routing stage [senior_officer]	warning	2026-07-16 11:36:46.026165
304	2	Logout	Sami_wubie signed out	info	2026-07-16 11:37:17.000734
305	3	Login	Elisu@Demoz signed in	info	2026-07-16 11:37:31.412546
306	3	Office Chain: Senior Officer Verified	Request REQ-2034 advanced from 'senior_officer' to 'authorizer'	info	2026-07-16 11:37:41.092946
307	3	Office Chain: Senior Officer Verified	Request REQ-2036 advanced from 'senior_officer' to 'authorizer'	info	2026-07-16 11:37:42.928053
308	3	Office Chain: Senior Officer Verified	Request REQ-2035 advanced from 'senior_officer' to 'authorizer'	info	2026-07-16 11:37:44.538297
309	3	Logout	Elisu@Demoz signed out	info	2026-07-16 11:37:48.354747
310	9	Login	basa@sami signed in	info	2026-07-16 11:38:17.699497
311	9	Office Chain: Department Head Verified	Request REQ-2036 advanced from 'authorizer' to 'approved'	info	2026-07-16 11:38:53.246448
312	2	Execution Complete	Staging modification metrics updated successfully for action: add	success	2026-07-16 11:38:53.268006
313	9	Office Chain: Department Head Verified	Request REQ-2035 advanced from 'authorizer' to 'approved'	info	2026-07-16 11:38:55.749006
314	2	Execution Complete	Staging modification metrics updated successfully for action: add	success	2026-07-16 11:38:55.75239
315	9	Office Chain: Department Head Verified	Request REQ-2034 advanced from 'authorizer' to 'approved'	info	2026-07-16 11:38:57.47858
316	2	Execution Complete	Staging modification metrics updated successfully for action: add	success	2026-07-16 11:38:57.482197
317	9	Office Chain: Department Head Verified	Request REQ-2031 advanced from 'authorizer' to 'approved'	info	2026-07-16 11:39:01.577731
318	11	Approved — Awaiting Payment	REQ-2031 approved, total fee: null	success	2026-07-16 11:39:01.581161
319	9	Logout	basa@sami signed out	info	2026-07-16 12:15:14.70399
320	1	Login	admin signed in	info	2026-07-16 12:21:03.712621
321	1	Logout	admin signed out	info	2026-07-16 12:46:52.245481
322	2	Login	Sami_wubie signed in	info	2026-07-16 12:48:20.6401
323	2	Requested	Submitted REQ-2037 — Permission: add: Create New Record: Gemstone Deposits of Ethiopia: A Geological Overview via routing stage [senior_officer]	warning	2026-07-16 12:54:30.475315
324	2	Requested	Submitted REQ-2038 — Permission: add: Create New Record: Hydrogeological Mapping of the Nile Basin Headwaters via routing stage [senior_officer]	warning	2026-07-16 13:01:59.931602
325	2	Requested	Submitted REQ-2039 — Permission: add: Create New Record: maps of ethiopia via routing stage [senior_officer]	warning	2026-07-16 13:05:51.786413
326	2	Logout	Sami_wubie signed out	info	2026-07-16 13:06:02.949532
327	3	Login	Elisu@Demoz signed in	info	2026-07-16 13:06:24.042732
328	3	Office Chain: Senior Officer Verified	Request REQ-2037 advanced from 'senior_officer' to 'authorizer'	info	2026-07-16 13:06:41.993225
329	3	Office Chain: Senior Officer Verified	Request REQ-2039 advanced from 'senior_officer' to 'authorizer'	info	2026-07-16 13:06:43.952932
330	3	Office Chain: Senior Officer Verified	Request REQ-2038 advanced from 'senior_officer' to 'authorizer'	info	2026-07-16 13:06:45.530344
331	3	Logout	Elisu@Demoz signed out	info	2026-07-16 13:06:51.43561
332	9	Login	basa@sami signed in	info	2026-07-16 13:07:10.745587
333	9	Office Chain: Department Head Verified	Request REQ-2039 advanced from 'authorizer' to 'approved'	info	2026-07-16 13:07:24.249119
334	2	Execution Complete	Staging modification metrics updated successfully for action: add	success	2026-07-16 13:07:24.252517
335	9	Office Chain: Department Head Verified	Request REQ-2038 advanced from 'authorizer' to 'approved'	info	2026-07-16 13:07:25.706838
336	2	Execution Complete	Staging modification metrics updated successfully for action: add	success	2026-07-16 13:07:25.708745
337	9	Office Chain: Department Head Verified	Request REQ-2037 advanced from 'authorizer' to 'approved'	info	2026-07-16 13:07:27.591302
338	2	Execution Complete	Staging modification metrics updated successfully for action: add	success	2026-07-16 13:07:27.593097
339	9	Logout	basa@sami signed out	info	2026-07-16 14:10:02.382397
340	1	Login	admin signed in	info	2026-07-16 14:10:04.731744
341	9	Logout	basa@sami signed out	info	2026-07-16 14:13:54.906475
342	1	Session terminated	Admin force-logged-out yoha@abebe	warning	2026-07-16 14:18:04.873103
343	1	Session terminated	Admin force-logged-out Teddy@shanbel	warning	2026-07-16 14:18:08.023821
344	1	Logout	admin signed out	info	2026-07-16 14:25:11.50486
345	1	Login	admin signed in	info	2026-07-16 14:30:01.255718
346	1	Logout	admin signed out	info	2026-07-17 07:46:58.7182
347	1	Login	admin signed in	info	2026-07-17 07:47:17.519426
348	1	Logout	admin signed out	info	2026-07-17 07:54:33.651411
349	1	Login	admin signed in	info	2026-07-17 07:54:38.76194
350	1	Logout	admin signed out	info	2026-07-17 07:57:43.039
351	3	Logout	Elisu@Demoz signed out	info	2026-07-17 09:55:40.982633
352	13	Account created	New self-registered account: Dibora_Dessie (User)	info	2026-07-17 09:57:25.820424
353	1	Login	admin signed in	info	2026-07-17 09:57:32.021962
354	1	Logout	admin signed out	info	2026-07-17 09:57:40.239123
355	14	Account created	New self-registered account: Rodas_Nega (User)	info	2026-07-17 10:01:16.872669
356	1	Login	admin signed in	info	2026-07-17 10:03:32.453233
357	1	Session terminated	Admin force-logged-out Dibora_Dessie	warning	2026-07-17 10:04:29.924882
358	1	Session terminated	Admin force-logged-out Rodas_Nega	warning	2026-07-17 10:04:33.302564
359	2	Login	Sami_wubie signed in	info	2026-07-17 10:05:19.341951
360	2	Logout	Sami_wubie signed out	info	2026-07-17 10:06:49.682224
361	1	Logout	admin signed out	info	2026-07-17 10:07:08.733557
362	1	Login	admin signed in	info	2026-07-17 10:07:57.486767
363	1	Logout	admin signed out	info	2026-07-17 10:12:40.329061
364	1	Login	admin signed in	info	2026-07-17 10:13:27.321714
365	1	Logout	admin signed out	info	2026-07-17 10:19:00.102153
366	1	Logout	admin signed out	info	2026-07-17 10:19:09.408032
367	1	Login	admin signed in	info	2026-07-17 10:19:11.336713
368	1	Download Requested	REQ-2040 — Industrial Mineral Resource Evaluation in the Amhara Region (normal, no approval needed)	info	2026-07-17 10:19:54.116771
369	1	Logout	admin signed out	info	2026-07-17 10:20:04.460392
370	2	Login	Sami_wubie signed in	info	2026-07-17 10:20:17.789707
371	2	Logout	Sami_wubie signed out	info	2026-07-17 10:22:38.68855
372	1	Login	admin signed in	info	2026-07-17 10:22:43.253168
373	1	Security Matrix Saved	Updated the global role access permissions matrix layout configuration blueprint	danger	2026-07-17 10:22:47.306693
374	1	Logout	admin signed out	info	2026-07-17 10:22:53.08452
375	2	Login	Sami_wubie signed in	info	2026-07-17 10:23:04.925435
376	2	Logout	Sami_wubie signed out	info	2026-07-17 10:24:29.951471
377	3	Login	Elisu@Demoz signed in	info	2026-07-17 10:24:42.136296
378	3	Downloaded	Elisu@Demoz (Senior Officer) downloaded "Industrial Mineral Resource Evaluation in the Amhara Region" — staff, no fee	info	2026-07-17 10:24:53.166455
379	3	Logout	Elisu@Demoz signed out	info	2026-07-17 10:29:54.259594
380	1	Login	admin signed in	info	2026-07-17 10:29:58.514109
381	1	Security Matrix Saved	Updated the global role access permissions matrix layout configuration blueprint	danger	2026-07-17 10:30:20.170252
382	1	Logout	admin signed out	info	2026-07-17 10:30:26.683011
383	2	Login	Sami_wubie signed in	info	2026-07-17 10:30:47.975594
384	2	Downloaded	Sami_wubie (Officer) downloaded "Industrial Mineral Resource Evaluation in the Amhara Region" — staff, no fee	info	2026-07-17 10:32:26.650923
385	2	Logout	Sami_wubie signed out	info	2026-07-17 10:42:35.588108
386	2	Login	Sami_wubie signed in	info	2026-07-17 10:43:44.36696
387	2	Downloaded	Sami_wubie (Officer) downloaded "Industrial Mineral Resource Evaluation in the Amhara Region" — staff, no fee	info	2026-07-17 10:43:52.683637
388	2	Logout	Sami_wubie signed out	info	2026-07-17 10:55:43.068756
389	2	Logout	Sami_wubie signed out	info	2026-07-17 10:55:46.842802
390	2	Login	Sami_wubie signed in	info	2026-07-17 10:56:02.866966
391	2	Download Requested	REQ-2041 — Industrial Mineral Resource Evaluation in the Amhara Region routed to [senior_officer] (normal)	warning	2026-07-17 10:57:07.218751
392	2	Logout	Sami_wubie signed out	info	2026-07-17 10:57:49.556519
393	3	Login	Elisu@Demoz signed in	info	2026-07-17 10:58:02.684692
394	3	Office Chain: Senior Officer Verified	Request REQ-2041 advanced from 'senior_officer' to 'approved'	info	2026-07-17 10:58:17.726892
395	2	Approved — Awaiting Payment	REQ-2041 approved, total fee: 0.00	success	2026-07-17 10:58:17.737742
396	3	Logout	Elisu@Demoz signed out	info	2026-07-17 10:58:28.871367
397	1	Login	admin signed in	info	2026-07-17 10:58:30.794456
398	1	Logout	admin signed out	info	2026-07-17 10:58:35.493139
399	2	Login	Sami_wubie signed in	info	2026-07-17 10:58:58.018199
400	2	Downloaded	REQ-2041 — file delivered	info	2026-07-17 10:59:06.526446
401	2	Logout	Sami_wubie signed out	info	2026-07-17 11:08:45.153258
402	2	Login	Sami_wubie signed in	info	2026-07-17 11:08:59.910485
403	2	Downloaded	REQ-2041 — file delivered	info	2026-07-17 11:09:29.912675
404	2	Downloaded	REQ-2041 — file delivered	info	2026-07-17 11:09:35.954288
405	2	Download Requested	REQ-2042 — Mapping Artisanal Gold Mining Sectors Using Remote Sensing routed to [senior_officer] (normal)	warning	2026-07-17 11:09:48.331715
406	2	Logout	Sami_wubie signed out	info	2026-07-17 11:09:58.093908
407	3	Login	Elisu@Demoz signed in	info	2026-07-17 11:10:12.988583
408	3	Office Request Rejected	Request REQ-2042 rejected at stage 'senior_officer': asdfghjkl	danger	2026-07-17 11:10:34.259278
409	3	Logout	Elisu@Demoz signed out	info	2026-07-17 11:10:42.032455
410	2	Login	Sami_wubie signed in	info	2026-07-17 11:10:55.526191
411	2	Logout	Sami_wubie signed out	info	2026-07-17 11:21:20.338866
412	1	Login	admin signed in	info	2026-07-17 11:21:24.04841
413	1	Logout	admin signed out	info	2026-07-17 11:21:37.672311
414	3	Login	Elisu@Demoz signed in	info	2026-07-17 11:22:08.349969
415	3	Logout	Elisu@Demoz signed out	info	2026-07-17 11:22:52.055926
416	2	Login	Sami_wubie signed in	info	2026-07-17 11:23:03.812556
417	2	Requested	Submitted REQ-2043 — Permission: add: Create New Record: Seismic Monitoring Networks of the Ethiopian Geoscience Institute via routing stage [senior_officer]	warning	2026-07-17 11:25:57.773234
418	2	Logout	Sami_wubie signed out	info	2026-07-17 11:32:35.874195
419	2	Login	Sami_wubie signed in	info	2026-07-17 11:33:21.324768
420	2	Logout	Sami_wubie signed out	info	2026-07-17 11:33:42.23206
421	3	Login	Elisu@Demoz signed in	info	2026-07-17 11:33:54.387874
422	3	Office Chain: Senior Officer Verified	Request REQ-2043 advanced from 'senior_officer' to 'authorizer'	info	2026-07-17 11:34:04.313966
423	3	Logout	Elisu@Demoz signed out	info	2026-07-17 11:34:27.752083
424	1	Login	admin signed in	info	2026-07-17 11:34:29.378915
425	14	Login	Rodas_Nega signed in	info	2026-07-17 11:39:33.827264
426	14	Logout	Rodas_Nega signed out	info	2026-07-17 11:45:20.651434
427	2	Login	Sami_wubie signed in	info	2026-07-17 12:29:35.907821
428	2	Logout	Sami_wubie signed out	info	2026-07-17 12:32:59.807852
429	3	Login	Elisu@Demoz signed in	info	2026-07-17 12:33:22.092778
430	3	Logout	Elisu@Demoz signed out	info	2026-07-17 12:37:01.008516
431	9	Login	basa@sami signed in	info	2026-07-17 12:37:17.479947
432	9	Office Chain: Department Head Verified	Request REQ-2043 advanced from 'authorizer' to 'approved'	info	2026-07-17 12:37:37.897808
433	2	Execution Complete	Staging modification metrics updated successfully for action: add	success	2026-07-17 12:37:37.913917
434	9	Logout	basa@sami signed out	info	2026-07-17 12:40:42.855094
435	2	Login	Sami_wubie signed in	info	2026-07-17 12:40:58.189559
436	2	Logout	Sami_wubie signed out	info	2026-07-17 12:47:46.773365
437	14	Login	Rodas_Nega signed in	info	2026-07-17 13:45:04.126306
438	14	Logout	Rodas_Nega signed out	info	2026-07-17 13:50:54.162244
439	2	Login	Sami_wubie signed in	info	2026-07-17 13:51:20.843245
440	2	Logout	Sami_wubie signed out	info	2026-07-17 13:57:55.576753
441	1	Login	admin signed in	info	2026-07-17 14:03:52.005632
442	1	Logout	admin signed out	info	2026-07-17 14:19:44.582074
443	1	Login	admin signed in	info	2026-07-17 14:21:54.928053
444	1	Logout	admin signed out	info	2026-07-17 14:23:55.084457
445	1	Login	admin signed in	info	2026-07-17 14:40:04.385211
446	1	Logout	admin signed out	info	2026-07-17 14:42:45.350508
447	1	Login	admin signed in	info	2026-07-17 14:47:19.492053
448	1	Logout	admin signed out	info	2026-07-17 14:47:29.755448
449	1	Login	admin signed in	info	2026-07-17 14:47:31.792805
450	1	Logout	admin signed out	info	2026-07-17 14:47:42.827893
451	14	Login	Rodas_Nega signed in	info	2026-07-17 14:48:02.798171
452	14	Logout	Rodas_Nega signed out	info	2026-07-17 14:49:30.890871
453	1	Login	admin signed in	info	2026-07-17 14:52:51.292301
454	1	Password reset	admin reset their password	warning	2026-07-17 14:55:32.687798
455	1	Login	admin signed in	info	2026-07-17 14:55:50.457192
456	1	Logout	admin signed out	info	2026-07-17 14:56:04.110616
457	1	Logout	admin signed out	info	2026-07-17 14:56:39.427599
458	1	Login	admin signed in	info	2026-07-17 14:59:32.541313
491	1	Login	admin signed in	info	2026-07-17 22:42:19.666173
492	1	Logout	admin signed out	info	2026-07-17 22:44:58.521865
493	1	Login	admin signed in	info	2026-07-17 23:56:32.900068
494	1	Logout	admin signed out	info	2026-07-17 23:58:10.382628
495	2	Login	Sami_wubie signed in	info	2026-07-17 23:58:34.771703
496	2	Logout	Sami_wubie signed out	info	2026-07-18 00:44:58.499706
497	1	Login	admin signed in	info	2026-07-18 00:56:01.849117
498	1	Login	admin signed in	info	2026-07-18 01:00:39.946033
499	1	Logout	admin signed out	info	2026-07-18 01:07:00.242388
500	1	Login	admin signed in	info	2026-07-18 01:09:46.486335
501	1	Logout	admin signed out	info	2026-07-18 01:17:06.585162
502	1	Login	admin signed in	info	2026-07-18 01:40:15.909578
503	1	Logout	admin signed out	info	2026-07-18 01:43:00.221796
504	2	Login	Sami_wubie signed in	info	2026-07-18 02:11:32.784661
505	2	Download Requested	REQ-2044 — Seismic Monitoring Networks of the Ethiopian Geoscience Institute routed to [senior_officer] (normal)	warning	2026-07-18 02:14:24.699549
506	2	Logout	Sami_wubie signed out	info	2026-07-18 02:17:27.742683
507	2	Login	Sami_wubie signed in	info	2026-07-18 02:18:14.758788
508	2	Requested	Submitted REQ-2045 — Permission: edit: Update Record: Seismic Monitoring Networks of the Ethiopian Geoscience Institute via routing stage [senior_officer]	warning	2026-07-18 02:20:01.065666
509	2	Logout	Sami_wubie signed out	info	2026-07-18 02:22:14.840924
510	1	Login	admin signed in	info	2026-07-18 02:24:32.385442
511	1	Role changed	yoha@abebe role changed to Senior Officer	warning	2026-07-18 02:24:47.189995
512	1	Role changed	Alem.kebede role changed to Department Head	warning	2026-07-18 02:24:52.455788
513	1	Logout	admin signed out	info	2026-07-18 02:25:42.933977
514	2	Login	Sami_wubie signed in	info	2026-07-18 02:25:59.850865
515	2	Logout	Sami_wubie signed out	info	2026-07-18 02:29:00.219815
516	2	Login	Sami_wubie signed in	info	2026-07-18 02:33:29.953179
517	2	Requested	Submitted REQ-2046 — Permission: edit: Update Record: Industrial Mineral Resource Evaluation in the Amhara Region via routing stage [senior_officer]	warning	2026-07-18 02:36:23.613999
518	2	Logout	Sami_wubie signed out	info	2026-07-18 02:36:36.313106
519	1	Login	admin signed in	info	2026-07-18 02:36:45.924782
520	1	Logout	admin signed out	info	2026-07-18 02:37:11.252666
521	10	Login	yoha@abebe signed in	info	2026-07-18 02:37:31.461005
522	10	Office Request Rejected	Request REQ-2045 rejected at stage 'senior_officer': B/C i checked the original document so It was corrected when they upload.	danger	2026-07-18 02:39:02.747212
523	10	Office Chain: Senior Officer Verified	Request REQ-2046 advanced from 'senior_officer' to 'authorizer'	info	2026-07-18 02:39:08.820795
524	3	Login	Elisu@Demoz signed in	info	2026-07-18 02:40:15.906944
525	3	Office Chain: Senior Officer Verified	Request REQ-2044 advanced from 'senior_officer' to 'approved'	info	2026-07-18 02:41:08.128327
526	2	Approved — Ready to Download	REQ-2044 approved, total fee: 0.00	success	2026-07-18 02:41:08.132842
527	3	Logout	Elisu@Demoz signed out	info	2026-07-18 02:41:24.179508
528	2	Login	Sami_wubie signed in	info	2026-07-18 02:42:12.244727
529	2	Logout	Sami_wubie signed out	info	2026-07-18 02:46:00.215623
530	3	Login	Elisu@Demoz signed in	info	2026-07-18 02:50:20.758564
531	3	Logout	Elisu@Demoz signed out	info	2026-07-18 02:50:41.607264
532	2	Login	Sami_wubie signed in	info	2026-07-18 02:50:54.58415
533	10	Logout	yoha@abebe signed out	info	2026-07-18 02:51:43.513651
534	2	Login	Sami_wubie signed in	info	2026-07-18 02:52:18.706036
535	2	Requested	Submitted REQ-2047 — Permission: edit: Update Record: Mapping Artisanal Gold Mining Sectors Using Remote Sensing via routing stage [senior_officer]	warning	2026-07-18 02:52:42.979336
536	2	Logout	Sami_wubie signed out	info	2026-07-18 02:52:47.406322
537	3	Login	Elisu@Demoz signed in	info	2026-07-18 02:52:59.91255
538	3	Office Chain: Senior Officer Verified	Request REQ-2047 advanced from 'senior_officer' to 'authorizer'	info	2026-07-18 02:53:16.531772
539	2	Login	Sami_wubie signed in	info	2026-07-18 12:09:25.160706
540	2	Logout	Sami_wubie signed out	info	2026-07-18 12:12:54.125013
541	1	Login	admin signed in	info	2026-07-18 12:15:41.062508
542	1	Security Matrix Saved	Updated the global role access permissions matrix layout configuration blueprint	danger	2026-07-18 12:20:46.22542
543	1	Security Matrix Saved	Updated the global role access permissions matrix layout configuration blueprint	danger	2026-07-18 12:20:48.43801
544	1	Logout	admin signed out	info	2026-07-18 12:30:27.011555
545	2	Login	Sami_wubie signed in	info	2026-07-18 12:30:40.845585
546	2	Requested	Submitted REQ-2048 — Permission: add: Create New Record: Geological History of Ethiopia via routing stage [senior_officer]	warning	2026-07-18 12:35:08.438812
547	2	Logout	Sami_wubie signed out	info	2026-07-18 12:37:58.997672
548	9	Login	basa@sami signed in	info	2026-07-18 12:38:15.25741
549	9	Logout	basa@sami signed out	info	2026-07-18 12:38:35.871851
550	10	Login	yoha@abebe signed in	info	2026-07-18 12:38:47.207151
551	10	Office Chain: Senior Officer Verified	Request REQ-2048 advanced from 'senior_officer' to 'authorizer'	info	2026-07-18 12:39:49.672219
552	10	Logout	yoha@abebe signed out	info	2026-07-18 12:41:00.751387
553	9	Login	basa@sami signed in	info	2026-07-18 12:41:16.213604
554	9	Office Request Rejected	Request REQ-2048 rejected at stage 'authorizer': I don't like it	danger	2026-07-18 12:41:59.194938
555	9	Logout	basa@sami signed out	info	2026-07-18 12:42:10.094207
556	2	Login	Sami_wubie signed in	info	2026-07-18 12:42:23.127767
557	2	Logout	Sami_wubie signed out	info	2026-07-18 12:45:43.156578
558	1	Login	admin signed in	info	2026-07-18 14:04:18.533529
559	1	Security Matrix Saved	Updated the global role access permissions matrix layout configuration blueprint	danger	2026-07-18 14:23:15.472378
560	1	Security Matrix Saved	Updated the global role access permissions matrix layout configuration blueprint	danger	2026-07-18 14:23:38.390479
561	1	Security Matrix Saved	Updated the global role access permissions matrix layout configuration blueprint	danger	2026-07-18 14:23:43.326497
562	1	Workflow Responsibility Saved	Updated the dynamic routing chain layout mapping structure	danger	2026-07-18 14:23:52.004345
563	1	Workflow Responsibility Saved	Updated the dynamic routing chain layout mapping structure	danger	2026-07-18 14:23:52.908229
564	1	Role changed	Sami_wubie role changed to Senior Officer	warning	2026-07-18 14:24:59.675349
565	1	Logout	admin signed out	info	2026-07-18 14:29:48.72659
566	1	Login	admin signed in	info	2026-07-18 14:30:19.328136
567	1	Logout	admin signed out	info	2026-07-18 14:33:29.352108
568	2	Login	Sami_wubie signed in	info	2026-07-18 14:51:01.011085
569	2	Logout	Sami_wubie signed out	info	2026-07-18 14:51:25.04587
570	1	Login	admin signed in	info	2026-07-18 14:51:27.558961
571	1	Security Matrix Saved	Updated the global role access permissions matrix layout configuration blueprint	danger	2026-07-18 14:51:41.613358
572	1	Logout	admin signed out	info	2026-07-18 14:51:47.623957
573	2	Login	Sami_wubie signed in	info	2026-07-18 14:52:24.360546
574	2	Logout	Sami_wubie signed out	info	2026-07-18 14:53:05.476676
575	1	Login	admin signed in	info	2026-07-18 14:53:06.960383
576	1	Role changed	Sami_wubie role changed to Officer	warning	2026-07-18 14:53:18.779737
577	1	Logout	admin signed out	info	2026-07-18 14:53:27.964157
578	2	Login	Sami_wubie signed in	info	2026-07-18 14:53:49.374064
579	2	Logout	Sami_wubie signed out	info	2026-07-18 14:54:18.168992
580	1	Login	admin signed in	info	2026-07-18 14:54:19.936324
581	1	Security Matrix Saved	Updated the global role access permissions matrix layout configuration blueprint	danger	2026-07-18 14:54:25.178054
582	1	Logout	admin signed out	info	2026-07-18 14:54:28.990117
583	2	Login	Sami_wubie signed in	info	2026-07-18 14:54:41.919749
584	2	Requested	Submitted REQ-2049 — Permission: add: Create New Record: Land slide via routing stage [senior_officer]	warning	2026-07-18 14:57:16.520538
585	2	Logout	Sami_wubie signed out	info	2026-07-18 14:57:57.401512
\.


--
-- Data for Name: books; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.books (id, title, author, department, location, published_year, file_path, page_count, uploaded_by, download_count, created_at, updated_at, category, report_topic, map_type, map_format, scale, document_class, security_class) FROM stdin;
5	Networking revolution	mekdes mulaw	It	Adama	2021	mekdes mulaw.pdf	12	\N	0	2026-06-18 02:52:06.804028	2026-06-18 02:52:06.804028	other_publication	\N	\N	\N	\N	normal	normal
8	Rock formation	soliyan demoz	Geology	Bahirdar	2021	soliyan demoz.pdf	12	\N	0	2026-06-18 02:52:06.804028	2026-06-18 02:52:06.804028	other_publication	\N	\N	\N	\N	normal	normal
9	Mapping of Ethiopia	yared misganaw	Geology	Adama	2022	yared misganaw.pdf	12	\N	0	2026-06-18 02:52:06.804028	2026-06-18 02:52:06.804028	other_publication	\N	\N	\N	\N	normal	normal
12	History of Ethiopia	Lemma alemu	Novel	Adama	2021	\N	12	\N	0	2026-06-18 02:52:06.804028	2026-06-18 02:52:06.804028	other_publication	\N	\N	\N	\N	normal	normal
14	hhh	ddd	ddd	addis ababa	2020	\N	12	\N	0	2026-06-18 02:52:06.804028	2026-06-18 02:52:06.804028	other_publication	\N	\N	\N	\N	normal	normal
4	Data structure	bealu girma	It	Addis ababa	2025	bealu girma.pdf	12	\N	0	2026-06-18 02:52:06.804028	2026-06-18 02:52:06.804028	other_publication	\N	\N	\N	\N	normal	normal
7	Cybersecurrity improvement	Samuel wubie	It	Addis ababa	2020	samuel wubie.pdf	12	\N	0	2026-06-18 02:52:06.804028	2026-06-18 02:52:06.804028	other_publication	\N	\N	\N	\N	normal	normal
2	Fikir eske mekabir	addis alemayehu	Novel	bahirdar	2022	addis alemayehu.pdf	20	\N	0	2026-06-18 02:52:06.804028	2026-06-18 02:52:06.804028	other_publication	\N	\N	\N	\N	normal	normal
15	Geospatial Report	Alem kebede	Geology	Adama	2023	1781978126249-alem kebede.pdf	12	\N	0	2026-06-20 10:55:26.307141	2026-06-20 10:55:26.307141	other_publication	\N	\N	\N	\N	normal	normal
6	Ethiopian Resources	mulu mesfin	Geology	Adama	2022	mulu mesfin.pdf	12	\N	1	2026-06-18 02:52:06.804028	2026-06-18 02:52:06.804028	other_publication	\N	\N	\N	\N	normal	normal
10	Dirtogada	Yismake Worku	Novel	Addis ababa	2025	yismake worku.pdf	12	\N	1	2026-06-18 02:52:06.804028	2026-06-18 02:52:06.804028	other_publication	\N	\N	\N	\N	normal	normal
1	Survey of Ethiopia	abebe kebede	Geology	addis ababa	2026	abebe kebede.pdf	12	\N	4	2026-06-18 02:52:06.804028	2026-06-22 00:41:54.556375	other_publication	\N	\N	\N	\N	normal	normal
3	Short fictions	Alemayehu Gelagay	Novel	bahirdar	2030	alemayehu gelagay.pdf	12	\N	1	2026-06-18 02:52:06.804028	2026-07-12 05:10:25.795854	other_publication	\N	\N	\N	\N	normal	normal
16	Rare Earth Element Potential in Southern Ethiopia	Abebe Kebede	Geology	Hawassa	1998	\N	12	\N	0	2026-07-16 10:43:51.599407	2026-07-16 10:43:51.599407	\N	\N	\N	\N	\N	normal	normal
17	Mapping Artisanal Gold Mining Sectors Using Remote Sensing	Addis Alemayehu	Geoscience	Addis Ababa	2002	\N	12	\N	0	2026-07-16 10:43:51.599407	2026-07-16 10:43:51.599407	\N	\N	\N	\N	\N	normal	normal
18	Industrial Mineral Resource Evaluation in the Amhara Region	Alem Kebede	Geology	Gondar	1985	\N	12	\N	0	2026-07-16 10:43:51.599407	2026-07-16 10:43:51.599407	\N	\N	\N	\N	\N	normal	normal
19	Gemstone Deposits of Ethiopia: A Geological Overview	Alemayehu Gelagay	Geology	Addis Ababa	2001	\N	12	\N	0	2026-07-16 10:43:51.599407	2026-07-16 10:43:51.599407	\N	\N	\N	\N	\N	normal	normal
20	Hydrogeological Mapping of the Nile Basin Headwaters	Bealu Girma	Hydrogeology	Gondar	2001	\N	12	\N	0	2026-07-16 10:43:51.599407	2026-07-16 10:43:51.599407	\N	\N	\N	\N	\N	normal	normal
21	Groundwater Salinity and Fluoride Distribution in Rift Aquifers	Bitanita Amanuel	Hydrogeology	Adama	2003	\N	12	\N	0	2026-07-16 10:43:51.599407	2026-07-16 10:43:51.599407	\N	\N	\N	\N	\N	normal	normal
22	Climate Change Impacts on Ethiopian Aquifer Recharges	Efrata Melku	Hydrogeology	Hawassa	2002	\N	12	\N	0	2026-07-16 10:43:51.599407	2026-07-16 10:43:51.599407	\N	\N	\N	\N	\N	normal	normal
23	Managed Aquifer Recharge Potential in Arid Ethiopian Regions	Eyob Lemma	Drilling	Mekele	2007	\N	12	\N	0	2026-07-16 10:43:51.599407	2026-07-16 10:43:51.599407	\N	\N	\N	\N	\N	normal	normal
24	Crustal Thinning and Rifting Dynamics in the Afar Depression	Fekade Ephrem	Geophysics	Adama	2005	\N	12	\N	0	2026-07-16 10:43:51.599407	2026-07-16 10:43:51.599407	\N	\N	\N	\N	\N	normal	normal
25	Structural Controls on Mineralization in the Arabian-Nubian Shield	Gebremichael Keffale	Geology	Mekele	2010	\N	12	\N	0	2026-07-16 10:43:51.599407	2026-07-16 10:43:51.599407	\N	\N	\N	\N	\N	normal	normal
26	Fault Line Mapping and Seismic Risk in Addis Ababa	Kebede Asfawu	Geohazard	Addis Ababa	2005	\N	12	\N	0	2026-07-16 10:43:51.599407	2026-07-16 10:43:51.599407	\N	\N	\N	\N	\N	normal	normal
27	Geodetic Monitoring of Continental Breakup in Ethiopia	Lakech Admasu	Geophysics	Adama	2001	\N	12	\N	0	2026-07-16 10:43:51.599407	2026-07-16 10:43:51.599407	\N	\N	\N	\N	\N	normal	normal
28	Landslide Susceptibility Mapping in the Ethiopian Highlands	Lemlem Chala	Geohazard	Gondar	2008	\N	12	\N	0	2026-07-16 10:43:51.599407	2026-07-16 10:43:51.599407	\N	\N	\N	\N	\N	normal	normal
29	Soil Erosion Dynamics and Watershed Management Profiles	Mekdes Mulaw	Geoscience	Hawassa	2000	\N	12	\N	0	2026-07-16 10:43:51.599407	2026-07-16 10:43:51.599407	\N	\N	\N	\N	\N	normal	normal
30	Environmental Impacts of Mining Activities in Western Ethiopia	Mulu Mesfin	Geoscience	Addis Ababa	2000	\N	12	\N	0	2026-07-16 10:43:51.599407	2026-07-16 10:43:51.599407	\N	\N	\N	\N	\N	normal	normal
31	Establishing a National Geological Hazard Database for Ethiopia	Oliyad Abebe	Geohazard	Addis Ababa	2025	\N	12	\N	0	2026-07-16 10:43:51.599407	2026-07-16 10:43:51.599407	\N	\N	\N	\N	\N	normal	normal
32	Mapping Geothermal Potential in the Ethiopian Rift Valley	Samuel Wubie	Hydrogeology	Adama	2000	\N	12	\N	0	2026-07-16 10:43:51.599407	2026-07-16 10:43:51.599407	\N	\N	\N	\N	\N	normal	normal
33	Volcanic Hazard Assessment of the Main Ethiopian Rift	Selam Alemu	Geohazard	Hawassa	2003	\N	12	\N	0	2026-07-16 10:43:51.599407	2026-07-16 10:43:51.599407	\N	\N	\N	\N	\N	normal	normal
34	Geochemical Analysis of Thermal Springs in Afar	Sisay Chernet	Geoscience	Adama	1999	\N	12	\N	0	2026-07-16 10:43:51.599407	2026-07-16 10:43:51.599407	\N	\N	\N	\N	\N	normal	normal
35	Seismic Monitoring Networks of the Ethiopian Geoscience Institute	Soliyan Demoz	Geophysics	Addis Ababa	2001	\N	12	\N	0	2026-07-16 10:43:51.599407	2026-07-16 10:43:51.599407	\N	\N	\N	\N	\N	normal	normal
37	Mapping Artisanal Gold Mining Sectors Using Remote Sensing	Addis Alemayehu	Geoscience	Addis Ababa	2002	1784226932639-addis-alemayehu.pdf	12	2	0	2026-07-16 11:38:55.750789	2026-07-16 11:38:55.750789	technical_report	001 Abrasives (Pumice)	\N	\N	\N	normal	normal
38	Rare Earth Element Potential in Southern Ethiopia	Abebe Kebede	Geology	Hawassa	1998	1784226833825-abebe-kebede.pdf	12	2	0	2026-07-16 11:38:57.480521	2026-07-16 11:38:57.480521	technical_report	001 Abrasives (Pumice)	\N	\N	\N	normal	normal
39	maps of ethiopia	Ayalew denberu	Geology	Gondar	2021	1784232351541-building-management-system.zip	12	2	0	2026-07-16 13:07:24.250915	2026-07-16 13:07:24.250915	map	\N	geological	shapefile	1:50,000	normal	normal
40	Hydrogeological Mapping of the Nile Basin Headwaters	Bealu Girma	Hydrogeology	Gondar	2001	1784232119772-bealu-girma.pdf	12	2	0	2026-07-16 13:07:25.707882	2026-07-16 13:07:25.707882	technical_report	001 Abrasives (Pumice)	\N	\N	\N	normal	normal
41	Gemstone Deposits of Ethiopia: A Geological Overview	Alemayehu Gelagay	Geology	Addis Ababa	2001	1784231670424-alemayehu-gelagay.pdf	12	2	0	2026-07-16 13:07:27.59217	2026-07-16 13:07:27.59217	technical_report	001 Abrasives (Pumice)	\N	\N	\N	normal	normal
36	Industrial Mineral Resource Evaluation in the Amhara Region	Alem Kebede	Geology	Gondar	1985	1784227005960-alem-kebede.pdf	12	2	6	2026-07-16 11:38:53.249063	2026-07-16 11:38:53.249063	technical_report	001 Abrasives (Pumice)	\N	\N	\N	normal	normal
42	Seismic Monitoring Networks of the Ethiopian Geoscience Institute	Soliyan Demoz	Geophysics	Addis Ababa	2001	1784312757681-zz.pdf	12	2	0	2026-07-17 12:37:37.900461	2026-07-17 12:37:37.900461	technical_report	002 Kaolin Belesa Feldspar, Quartz	\N	\N	\N	normal	normal
\.


--
-- Data for Name: download_logs; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.download_logs (id, book_id, user_id, downloaded_at) FROM stdin;
\.


--
-- Data for Name: monthly_account_stats; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.monthly_account_stats (id, year_val, month_name, account_count) FROM stdin;
1	2026	Jan	3
2	2026	Feb	5
3	2026	Mar	4
4	2026	Apr	7
5	2026	May	6
6	2026	Jun	15
13	2026	Jul	3
\.


--
-- Data for Name: notifications; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.notifications (id, user_id, message, link, is_read, created_at, title, request_id) FROM stdin;
1	11	REQ-2031 moved to the next reviewer (Senior Officer).	\N	f	2026-07-15 07:57:02.858748	Request forwarded	7
2	11	REQ-2031 moved to the next reviewer (Department Head).	\N	f	2026-07-15 08:00:42.444711	Request forwarded	7
9	11	REQ-2031 — "Download Document: Survey of Ethiopia" was approved. Pay null to download it.	\N	f	2026-07-16 11:39:01.579398	Download request approved	7
19	2	REQ-2043 — all approvals are complete. Your new record "Create New Record: Seismic Monitoring Networks of the Ethiopian Geoscience Institute" has been added to the library.	\N	t	2026-07-17 12:37:37.91508	Request accepted	19
17	2	REQ-2042 — "Download Document: Mapping Artisanal Gold Mining Sectors Using Remote Sensing" was not approved.	\N	t	2026-07-17 11:10:34.261831	Request rejected	18
12	2	REQ-2038 moved to the next reviewer (Department Head).	\N	t	2026-07-16 13:06:45.53109	Request forwarded	14
11	2	REQ-2039 moved to the next reviewer (Department Head).	\N	t	2026-07-16 13:06:43.953753	Request forwarded	15
10	2	REQ-2037 moved to the next reviewer (Department Head).	\N	t	2026-07-16 13:06:41.995234	Request forwarded	13
8	2	REQ-2034 — "Create New Record: Rare Earth Element Potential in Southern Ethiopia" was approved and applied.	\N	t	2026-07-16 11:38:57.483745	Request approved	10
18	2	REQ-2043 — "Create New Record: Seismic Monitoring Networks of the Ethiopian Geoscience Institute" passed the Senior Officer review and is now with the Department Head.	\N	t	2026-07-17 11:34:04.316805	Request stage update	19
7	2	REQ-2035 — "Create New Record: Mapping Artisanal Gold Mining Sectors Using Remote Sensing" was approved and applied.	\N	t	2026-07-16 11:38:55.754667	Request approved	11
15	2	REQ-2037 — "Create New Record: Gemstone Deposits of Ethiopia: A Geological Overview" was approved and applied.	\N	t	2026-07-16 13:07:27.593832	Request approved	13
6	2	REQ-2036 — "Create New Record: Industrial Mineral Resource Evaluation in the Amhara Region" was approved and applied.	\N	t	2026-07-16 11:38:53.26911	Request approved	12
5	2	REQ-2035 moved to the next reviewer (Department Head).	\N	t	2026-07-16 11:37:44.540842	Request forwarded	11
4	2	REQ-2036 moved to the next reviewer (Department Head).	\N	t	2026-07-16 11:37:42.930191	Request forwarded	12
3	2	REQ-2034 moved to the next reviewer (Department Head).	\N	t	2026-07-16 11:37:41.0971	Request forwarded	10
16	2	REQ-2041 — "Download Document: Industrial Mineral Resource Evaluation in the Amhara Region" was approved. Pay 0.00 to download it.	\N	t	2026-07-17 10:58:17.728452	Download request approved	17
14	2	REQ-2038 — "Create New Record: Hydrogeological Mapping of the Nile Basin Headwaters" was approved and applied.	\N	t	2026-07-16 13:07:25.709454	Request approved	14
13	2	REQ-2039 — "Create New Record: maps of ethiopia" was approved and applied.	\N	t	2026-07-16 13:07:24.25311	Request approved	15
20	2	REQ-2045 — "Update Record: Seismic Monitoring Networks of the Ethiopian Geoscience Institute" was not approved.	\N	f	2026-07-18 02:39:02.749738	Request rejected	21
21	2	REQ-2046 — "Update Record: Industrial Mineral Resource Evaluation in the Amhara Region" passed the Senior Officer review and is now with the Department Head.	\N	f	2026-07-18 02:39:08.824657	Request stage update	22
22	2	REQ-2044 — all approvals are complete. You can now download "Download Document: Seismic Monitoring Networks of the Ethiopian Geoscience Institute" by clicking Download again.	\N	f	2026-07-18 02:41:08.131412	Download request accepted	20
23	2	REQ-2047 — "Update Record: Mapping Artisanal Gold Mining Sectors Using Remote Sensing" passed the Senior Officer review and is now with the Department Head.	\N	f	2026-07-18 02:53:16.53386	Request stage update	23
24	2	REQ-2048 — "Create New Record: Geological History of Ethiopia" passed the Senior Officer review and is now with the Department Head.	\N	f	2026-07-18 12:39:49.676463	Request stage update	24
25	2	REQ-2048 — "Create New Record: Geological History of Ethiopia" was not approved.	\N	t	2026-07-18 12:41:59.199118	Request rejected	24
\.


--
-- Data for Name: password_resets; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.password_resets (id, user_id, token, is_used, expires_at, created_at) FROM stdin;
\.


--
-- Data for Name: payments; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.payments (id, user_id, book_id, approval_request_id, price_per_page, free_preview_pages, page_count, total_amount, status, payment_reference, created_at, updated_at, request_id, fee_per_page, gateway) FROM stdin;
\.


--
-- Data for Name: role_permissions; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.role_permissions (role_name, can_view, can_edit, can_delete, can_download, updated_at) FROM stdin;
User	t	f	f	f	2026-06-24 12:31:14.919424
Officer	t	t	f	t	2026-06-24 12:31:14.919424
Senior Officer	t	t	t	t	2026-06-24 12:31:14.919424
Department Head	t	t	t	t	2026-06-24 12:31:14.919424
\.


--
-- Data for Name: roles; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.roles (id, role_name, responsibility, created_at) FROM stdin;
1	User	None	2026-06-18 02:52:06.804028
2	Officer	Maker	2026-06-18 02:52:06.804028
3	Senior Officer	Checker	2026-06-18 02:52:06.804028
4	Department Head	Authorizer	2026-06-18 02:52:06.804028
\.


--
-- Data for Name: system_settings; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.system_settings (setting_key, config_data, updated_at) FROM stdin;
responsibility_map	[{"role": "Officer", "stage": "officer"}, {"role": "Senior Officer", "stage": "senior_officer"}, {"role": "Department Head", "stage": "authorizer"}]	2026-07-18 14:23:52.905345
access_matrix	{"User": {"edit": false, "view": true, "delete": false, "download": true}, "Officer": {"edit": true, "view": true, "delete": true, "download": false}, "Senior Officer": {"edit": true, "view": true, "delete": false, "download": true}, "Department Head": {"edit": true, "view": true, "delete": true, "download": true}}	2026-07-18 14:54:25.17672
class_fees	{"medium": 4.5, "normal": 2, "strict": 10}	2026-07-15 07:55:30.449437
\.


--
-- Data for Name: tasks; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.tasks (id, document_title, sender_id, approver_id, status) FROM stdin;
\.


--
-- Data for Name: users; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.users (id, username, email, password_hash, role_id, department, status, last_active_at, created_at, "firstName", "middleName", "lastName", role, full_name) FROM stdin;
13	Dibora_Dessie	diboradessie@gmail.com	$2b$10$zpz8e9XjGTTjvMpBia81y.WDBZeFYNIgDFn80H30V8sStWZ7VUrS.	\N	\N	Inactive	\N	2026-07-17 09:57:25.753444	\N	\N	\N	User	Dibora Dessie Lemma
12	Teddy@shanbel	tedyyesha21@gmail.com	$2b$10$lGfaboH/ccIdvbva6qA/yuUkDZ.iV039fu05jwBJFeFQ.jVC8l2K6	\N	\N	Inactive	\N	2026-07-12 05:04:29.114286	\N	\N	\N	User	Tewedros Yeshanbel Derebe
2	Sami_wubie	samiwubi27@gmail.com	$2b$10$Jegbm0zrLkmmeRgfr49R3OJrmIAh3s5WyXoO8pnyz1Ibr2PAERT9K	\N	\N	Inactive	2026-07-18 14:57:36.942265	2026-06-20 00:37:14.427348	\N	\N	\N	Officer	\N
10	yoha@abebe	yohannes2sebsibe@gmail.com	$2b$10$ss7kOg1zR2PlAAHI8R/uSOPMpHxIDBBEOwvqjAbPnPz5sxnfOvEEq	\N	\N	Inactive	2026-07-18 12:40:52.236012	2026-06-24 11:50:34.962794	\N	\N	\N	Senior Officer	Yohannes Sebsibe Abebe
14	Rodas_Nega	rodinanega21@gmail.com	$2b$10$fdt1ApASZ04TUtEQkeLBYO/uwzsUcMdjm8GqsgWzJYstHOorVu1SW	\N	\N	Inactive	2026-07-17 14:49:17.82112	2026-07-17 10:01:16.851457	\N	\N	\N	User	Rodas Nega Abrham
9	basa@sami	elshaday@gmail.com	$2b$10$88uAtMPEssP8Ud2qtdGw7.3FwTP6d6J1p5Qqrx2RWmDZfgjU0cKrq	\N	\N	Inactive	2026-07-18 12:42:06.241623	2026-06-20 14:02:09.436767	\N	\N	\N	Department Head	\N
11	Alem.kebede	alem2sebsibe@gmail.com	$2b$10$2kMcYu/l3kDv.6n8Ii20xOMDnRDjxlkmTka6pFom1DY..SbuFxBVC	\N	\N	Inactive	2026-07-12 13:25:00.688354	2026-06-24 12:23:06.181462	\N	\N	\N	Department Head	alem kebede lema
1	admin	admin@gie.gov.et	$2b$10$9g4CUUBrOMlm7lo08OWCW.TCm8fol1tTb8JlP6L//UD0.ZXP5GKxi	4	Geoscience Data	Inactive	2026-07-18 14:54:19.950044	2026-06-18 02:52:06.804028	\N	\N	\N	admin	\N
3	Elisu@Demoz	elishaday2demoz@gmail.com	$2b$10$bmaa4M0uQ5WF4lRQllOLR.U0aktvZ6xm6wDldSdPPozDA3QmiJfZG	\N	\N	Active	2026-07-18 02:53:24.937414	2026-06-20 11:01:53.118201	Elishaday	Demoz	Getie	Senior Officer	\N
\.


--
-- Name: approval_requests_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.approval_requests_id_seq', 25, true);


--
-- Name: audit_logs_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.audit_logs_id_seq', 585, true);


--
-- Name: books_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.books_id_seq', 42, true);


--
-- Name: download_logs_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.download_logs_id_seq', 1, false);


--
-- Name: monthly_account_stats_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.monthly_account_stats_id_seq', 15, true);


--
-- Name: notifications_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.notifications_id_seq', 25, true);


--
-- Name: password_resets_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.password_resets_id_seq', 1, false);


--
-- Name: payments_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.payments_id_seq', 3, true);


--
-- Name: roles_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.roles_id_seq', 4, true);


--
-- Name: tasks_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.tasks_id_seq', 1, false);


--
-- Name: users_id_seq; Type: SEQUENCE SET; Schema: public; Owner: -
--

SELECT pg_catalog.setval('public.users_id_seq', 14, true);


--
-- Name: approval_requests approval_requests_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.approval_requests
    ADD CONSTRAINT approval_requests_pkey PRIMARY KEY (id);


--
-- Name: approval_requests approval_requests_request_code_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.approval_requests
    ADD CONSTRAINT approval_requests_request_code_key UNIQUE (request_code);


--
-- Name: audit_logs audit_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_logs
    ADD CONSTRAINT audit_logs_pkey PRIMARY KEY (id);


--
-- Name: books books_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.books
    ADD CONSTRAINT books_pkey PRIMARY KEY (id);


--
-- Name: download_logs download_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.download_logs
    ADD CONSTRAINT download_logs_pkey PRIMARY KEY (id);


--
-- Name: monthly_account_stats monthly_account_stats_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.monthly_account_stats
    ADD CONSTRAINT monthly_account_stats_pkey PRIMARY KEY (id);


--
-- Name: monthly_account_stats monthly_account_stats_year_val_month_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.monthly_account_stats
    ADD CONSTRAINT monthly_account_stats_year_val_month_name_key UNIQUE (year_val, month_name);


--
-- Name: notifications notifications_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_pkey PRIMARY KEY (id);


--
-- Name: password_resets password_resets_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.password_resets
    ADD CONSTRAINT password_resets_pkey PRIMARY KEY (id);


--
-- Name: password_resets password_resets_token_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.password_resets
    ADD CONSTRAINT password_resets_token_key UNIQUE (token);


--
-- Name: payments payments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payments
    ADD CONSTRAINT payments_pkey PRIMARY KEY (id);


--
-- Name: role_permissions role_permissions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.role_permissions
    ADD CONSTRAINT role_permissions_pkey PRIMARY KEY (role_name);


--
-- Name: roles roles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.roles
    ADD CONSTRAINT roles_pkey PRIMARY KEY (id);


--
-- Name: roles roles_role_name_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.roles
    ADD CONSTRAINT roles_role_name_key UNIQUE (role_name);


--
-- Name: system_settings system_settings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.system_settings
    ADD CONSTRAINT system_settings_pkey PRIMARY KEY (setting_key);


--
-- Name: tasks tasks_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tasks
    ADD CONSTRAINT tasks_pkey PRIMARY KEY (id);


--
-- Name: users users_email_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_email_key UNIQUE (email);


--
-- Name: users users_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);


--
-- Name: users users_username_key; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_username_key UNIQUE (username);


--
-- Name: idx_approval_requests_payment; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_approval_requests_payment ON public.approval_requests USING btree (payment_status);


--
-- Name: idx_approval_requests_request_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_approval_requests_request_type ON public.approval_requests USING btree (request_type);


--
-- Name: idx_approval_requests_requested_by; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_approval_requests_requested_by ON public.approval_requests USING btree (requested_by);


--
-- Name: idx_approval_requests_stage; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_approval_requests_stage ON public.approval_requests USING btree (stage);


--
-- Name: idx_approval_requests_target_book; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_approval_requests_target_book ON public.approval_requests USING btree (target_book_id);


--
-- Name: idx_audit_logs_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_audit_logs_created_at ON public.audit_logs USING btree (created_at DESC);


--
-- Name: idx_audit_logs_severity; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_audit_logs_severity ON public.audit_logs USING btree (severity);


--
-- Name: idx_audit_logs_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_audit_logs_user_id ON public.audit_logs USING btree (user_id);


--
-- Name: idx_books_category; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_books_category ON public.books USING btree (category);


--
-- Name: idx_books_department; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_books_department ON public.books USING btree (department);


--
-- Name: idx_books_download_count; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_books_download_count ON public.books USING btree (download_count DESC);


--
-- Name: idx_books_location; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_books_location ON public.books USING btree (location);


--
-- Name: idx_books_map_type; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_books_map_type ON public.books USING btree (map_type);


--
-- Name: idx_books_published_year; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_books_published_year ON public.books USING btree (published_year);


--
-- Name: idx_books_report_topic; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_books_report_topic ON public.books USING btree (report_topic);


--
-- Name: idx_books_security_class; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_books_security_class ON public.books USING btree (security_class);


--
-- Name: idx_notifications_is_read; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_notifications_is_read ON public.notifications USING btree (is_read);


--
-- Name: idx_notifications_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_notifications_user_id ON public.notifications USING btree (user_id);


--
-- Name: idx_payments_request_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_payments_request_id ON public.payments USING btree (request_id);


--
-- Name: idx_payments_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_payments_status ON public.payments USING btree (status);


--
-- Name: idx_payments_user_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_payments_user_id ON public.payments USING btree (user_id);


--
-- Name: idx_users_role; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_users_role ON public.users USING btree (role);


--
-- Name: idx_users_status; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_users_status ON public.users USING btree (status);


--
-- Name: idx_users_username; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_users_username ON public.users USING btree (username);


--
-- Name: download_logs trg_sync_book_downloads; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_sync_book_downloads AFTER INSERT ON public.download_logs FOR EACH ROW EXECUTE FUNCTION public.sync_book_download_metrics();


--
-- Name: users trg_sync_user_registration; Type: TRIGGER; Schema: public; Owner: -
--

CREATE TRIGGER trg_sync_user_registration AFTER INSERT ON public.users FOR EACH ROW EXECUTE FUNCTION public.sync_user_registration_trends();


--
-- Name: approval_requests approval_requests_authorizer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.approval_requests
    ADD CONSTRAINT approval_requests_authorizer_id_fkey FOREIGN KEY (authorizer_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: approval_requests approval_requests_checker_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.approval_requests
    ADD CONSTRAINT approval_requests_checker_id_fkey FOREIGN KEY (checker_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: approval_requests approval_requests_officer_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.approval_requests
    ADD CONSTRAINT approval_requests_officer_id_fkey FOREIGN KEY (officer_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: approval_requests approval_requests_requested_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.approval_requests
    ADD CONSTRAINT approval_requests_requested_by_fkey FOREIGN KEY (requested_by) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: approval_requests approval_requests_target_book_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.approval_requests
    ADD CONSTRAINT approval_requests_target_book_id_fkey FOREIGN KEY (target_book_id) REFERENCES public.books(id) ON DELETE SET NULL;


--
-- Name: audit_logs audit_logs_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_logs
    ADD CONSTRAINT audit_logs_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: books books_uploaded_by_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.books
    ADD CONSTRAINT books_uploaded_by_fkey FOREIGN KEY (uploaded_by) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: download_logs download_logs_book_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.download_logs
    ADD CONSTRAINT download_logs_book_id_fkey FOREIGN KEY (book_id) REFERENCES public.books(id) ON DELETE CASCADE;


--
-- Name: download_logs download_logs_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.download_logs
    ADD CONSTRAINT download_logs_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE SET NULL;


--
-- Name: notifications notifications_request_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_request_id_fkey FOREIGN KEY (request_id) REFERENCES public.approval_requests(id);


--
-- Name: notifications notifications_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.notifications
    ADD CONSTRAINT notifications_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: password_resets password_resets_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.password_resets
    ADD CONSTRAINT password_resets_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: payments payments_approval_request_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payments
    ADD CONSTRAINT payments_approval_request_id_fkey FOREIGN KEY (approval_request_id) REFERENCES public.approval_requests(id);


--
-- Name: payments payments_book_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payments
    ADD CONSTRAINT payments_book_id_fkey FOREIGN KEY (book_id) REFERENCES public.books(id);


--
-- Name: payments payments_request_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payments
    ADD CONSTRAINT payments_request_id_fkey FOREIGN KEY (request_id) REFERENCES public.approval_requests(id);


--
-- Name: payments payments_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.payments
    ADD CONSTRAINT payments_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id);


--
-- Name: users users_role_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_role_id_fkey FOREIGN KEY (role_id) REFERENCES public.roles(id) ON DELETE SET NULL;


--
-- PostgreSQL database dump complete
--

\unrestrict o3Lpg89oCIwPhTcjLbQapf3Z4ykmKI54kVB3BcTBXtu0xr5GBeYWBzIyIWv0PjO

