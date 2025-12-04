-- Create app role enum
CREATE TYPE public.app_role AS ENUM ('admin', 'agent');

-- Create profiles table
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name TEXT NOT NULL,
  phone TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Create user roles table
CREATE TABLE public.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  role app_role NOT NULL,
  UNIQUE (user_id, role)
);

-- Create security definer function to check roles
CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role app_role)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles
    WHERE user_id = _user_id
      AND role = _role
  )
$$;

-- Create batches table
CREATE TABLE public.batches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  institution_name TEXT NOT NULL,
  upload_date TIMESTAMPTZ NOT NULL DEFAULT now(),
  uploaded_by UUID REFERENCES auth.users(id),
  customer_count INTEGER NOT NULL DEFAULT 0,
  total_amount DECIMAL(15,2) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Create master customers table
CREATE TABLE public.master_customers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nrc_number TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  mobile_number TEXT,
  loan_account_number TEXT,
  total_paid DECIMAL(15,2) NOT NULL DEFAULT 0,
  total_owed DECIMAL(15,2) NOT NULL DEFAULT 0,
  outstanding_balance DECIMAL(15,2) NOT NULL DEFAULT 0,
  payment_status TEXT NOT NULL DEFAULT 'Not Paid' CHECK (payment_status IN ('Not Paid', 'Partially Paid', 'Fully Paid')),
  call_notes TEXT DEFAULT '',
  assigned_agent UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Create batch customers table (links batches to master customers)
CREATE TABLE public.batch_customers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id UUID REFERENCES public.batches(id) ON DELETE CASCADE NOT NULL,
  master_customer_id UUID REFERENCES public.master_customers(id) ON DELETE CASCADE NOT NULL,
  nrc_number TEXT NOT NULL,
  name TEXT NOT NULL,
  mobile_number TEXT,
  amount_owed DECIMAL(15,2) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Create tickets table
CREATE TABLE public.tickets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  master_customer_id UUID REFERENCES public.master_customers(id) ON DELETE CASCADE NOT NULL,
  customer_name TEXT NOT NULL,
  nrc_number TEXT NOT NULL,
  mobile_number TEXT,
  amount_owed DECIMAL(15,2) NOT NULL DEFAULT 0,
  priority TEXT NOT NULL DEFAULT 'Medium' CHECK (priority IN ('High', 'Medium', 'Low')),
  status TEXT NOT NULL DEFAULT 'Open' CHECK (status IN ('Open', 'In Progress', 'Resolved')),
  assigned_agent UUID REFERENCES auth.users(id),
  call_notes TEXT DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_date TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Create payments table
CREATE TABLE public.payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id UUID REFERENCES public.tickets(id) ON DELETE SET NULL,
  master_customer_id UUID REFERENCES public.master_customers(id) ON DELETE CASCADE NOT NULL,
  customer_name TEXT NOT NULL,
  amount DECIMAL(15,2) NOT NULL,
  payment_method TEXT NOT NULL CHECK (payment_method IN ('Mobile Money', 'Bank')),
  payment_date TIMESTAMPTZ NOT NULL DEFAULT now(),
  notes TEXT DEFAULT '',
  recorded_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Create call logs table
CREATE TABLE public.call_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_id UUID REFERENCES public.tickets(id) ON DELETE CASCADE NOT NULL,
  master_customer_id UUID REFERENCES public.master_customers(id) ON DELETE CASCADE NOT NULL,
  agent_id UUID REFERENCES auth.users(id) NOT NULL,
  call_outcome TEXT NOT NULL,
  notes TEXT,
  promise_to_pay_date DATE,
  promise_to_pay_amount DECIMAL(15,2),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Enable RLS on all tables
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.master_customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.batch_customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tickets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.call_logs ENABLE ROW LEVEL SECURITY;

-- RLS Policies for profiles
CREATE POLICY "Users can view all profiles" ON public.profiles
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "Users can update own profile" ON public.profiles
  FOR UPDATE TO authenticated USING (auth.uid() = id);

CREATE POLICY "Users can insert own profile" ON public.profiles
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = id);

-- RLS Policies for user_roles (admin only management)
CREATE POLICY "Admins can view all roles" ON public.user_roles
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Users can view own role" ON public.user_roles
  FOR SELECT TO authenticated USING (auth.uid() = user_id);

CREATE POLICY "Admins can manage roles" ON public.user_roles
  FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin'));

-- RLS Policies for batches
CREATE POLICY "Authenticated users can view batches" ON public.batches
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "Admins can manage batches" ON public.batches
  FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin'));

-- RLS Policies for master_customers
CREATE POLICY "Agents see assigned customers" ON public.master_customers
  FOR SELECT TO authenticated 
  USING (
    public.has_role(auth.uid(), 'admin') OR assigned_agent = auth.uid()
  );

CREATE POLICY "Admins can manage customers" ON public.master_customers
  FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Agents can update assigned customers" ON public.master_customers
  FOR UPDATE TO authenticated 
  USING (assigned_agent = auth.uid());

-- RLS Policies for batch_customers
CREATE POLICY "View batch customers" ON public.batch_customers
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "Admins manage batch customers" ON public.batch_customers
  FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin'));

-- RLS Policies for tickets
CREATE POLICY "Agents see assigned tickets" ON public.tickets
  FOR SELECT TO authenticated 
  USING (
    public.has_role(auth.uid(), 'admin') OR assigned_agent = auth.uid()
  );

CREATE POLICY "Admins can manage tickets" ON public.tickets
  FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Agents can update assigned tickets" ON public.tickets
  FOR UPDATE TO authenticated 
  USING (assigned_agent = auth.uid());

-- RLS Policies for payments
CREATE POLICY "View relevant payments" ON public.payments
  FOR SELECT TO authenticated 
  USING (
    public.has_role(auth.uid(), 'admin') OR recorded_by = auth.uid()
  );

CREATE POLICY "Authenticated users can record payments" ON public.payments
  FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "Admins can manage payments" ON public.payments
  FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin'));

-- RLS Policies for call_logs
CREATE POLICY "View call logs" ON public.call_logs
  FOR SELECT TO authenticated 
  USING (
    public.has_role(auth.uid(), 'admin') OR agent_id = auth.uid()
  );

CREATE POLICY "Agents can add call logs" ON public.call_logs
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = agent_id);

CREATE POLICY "Admins can manage call logs" ON public.call_logs
  FOR ALL TO authenticated USING (public.has_role(auth.uid(), 'admin'));

-- Create function to handle new user signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, full_name)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email));
  
  -- Default new users to 'agent' role
  INSERT INTO public.user_roles (user_id, role)
  VALUES (NEW.id, 'agent');
  
  RETURN NEW;
END;
$$;

-- Create trigger for new user signup
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Create function to update timestamps
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

-- Add update triggers
CREATE TRIGGER update_profiles_updated_at
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_master_customers_updated_at
  BEFORE UPDATE ON public.master_customers
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_tickets_updated_at
  BEFORE UPDATE ON public.tickets
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();