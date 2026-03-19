
"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { Rocket, Mail, CheckCircle2, ChevronRight, Lock, Sparkles, Image as ImageIcon } from "lucide-react";
import Image from "next/image";

export default function WaitlistPage() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");

    try {
      const res = await fetch("/api/waitlist", {
        method: "POST",
        body: JSON.stringify({ email }),
        headers: { "Content-Type": "application/json" }
      });

      if (res.ok) {
        setSubmitted(true);
      } else {
        const data = await res.json();
        setError(data.error || "Something went wrong. Please try again.");
      }
    } catch (err) {
      setError("Failed to join the waitlist. Please check your connection.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#050505] text-white flex flex-col items-center justify-center p-6 relative overflow-hidden">
      {/* Background Glows */}
      <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-blue-600/20 blur-[120px] rounded-full" />
      <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-purple-600/20 blur-[120px] rounded-full" />

      <div className="max-w-6xl w-full grid grid-cols-1 lg:grid-cols-2 gap-12 items-center z-10">
        
        {/* Left Content */}
        <motion.div 
          initial={{ opacity: 0, x: -30 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.8 }}
          className="space-y-8"
        >
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/5 border border-white/10 text-sm font-medium text-blue-400">
            <Sparkles size={14} />
            <span>Currently in Private Beta</span>
          </div>
          
          <h1 className="text-5xl md:text-7xl font-bold leading-tight">
            One Photo. <br />
            <span className="gradient-text">Full Listing.</span>
          </h1>
          
          <p className="text-xl text-gray-400 leading-relaxed max-w-lg">
            Commerium uses state-of-the-art AI to transform your raw product photos into high-converting e-commerce listings in 60 seconds.
          </p>

          <div className="space-y-4">
            <div className="flex items-center gap-3 text-gray-300">
              <div className="w-10 h-10 rounded-lg bg-white/5 flex items-center justify-center border border-white/10">
                <ImageIcon size={20} className="text-blue-500" />
              </div>
              <div>
                <p className="font-semibold italic">Snap or Upload</p>
                <p className="text-sm text-gray-500">Any product, any angle.</p>
              </div>
            </div>
            <div className="flex items-center gap-3 text-gray-300">
              <div className="w-10 h-10 rounded-lg bg-white/5 flex items-center justify-center border border-white/10">
                <Sparkles size={20} className="text-purple-500" />
              </div>
              <div>
                <p className="font-semibold italic">AI Transformation</p>
                <p className="text-sm text-gray-500">Background removal + Copywriting.</p>
              </div>
            </div>
            <div className="flex items-center gap-3 text-gray-300">
              <div className="w-10 h-10 rounded-lg bg-white/5 flex items-center justify-center border border-white/10">
                <Rocket size={20} className="text-green-500" />
              </div>
              <div>
                <p className="font-semibold italic">One-Click Publish</p>
                <p className="text-sm text-gray-500">Sync directly to Shopify.</p>
              </div>
            </div>
          </div>

          <div className="pt-4">
            {submitted ? (
              <motion.div 
                initial={{ scale: 0.9, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                className="p-6 glass border-green-500/30 bg-green-500/5 flex flex-col items-center text-center space-y-3"
              >
                <CheckCircle2 size={48} className="text-green-500" />
                <h3 className="text-xl font-bold">You're on the list!</h3>
                <p className="text-gray-400">We'll notify you as soon as the Shopify App is live.</p>
              </motion.div>
            ) : (
              <div className="space-y-6">
                <div className="flex flex-col gap-2">
                  <div className="flex items-center gap-2 text-yellow-500 bg-yellow-500/10 px-4 py-2 rounded-lg border border-yellow-500/20 text-sm">
                    <Lock size={16} />
                    <span>Shopify App under review. Get early access below.</span>
                  </div>
                </div>
                
                <form onSubmit={handleSubmit} className="relative max-w-md group">
                  <div className="absolute inset-x-0 -bottom-px h-px bg-gradient-to-r from-transparent via-blue-500 to-transparent opacity-50 group-hover:opacity-100 transition-opacity" />
                  <div className="flex items-center gap-2 p-1.5 glass bg-white/5 border-white/10 focus-within:border-blue-500/50 transition-all">
                    <Mail className="ml-3 text-gray-500" size={20} />
                    <input 
                      type="email" 
                      placeholder="Enter your store email"
                      required
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      className="bg-transparent border-none focus:ring-0 text-white placeholder-gray-500 flex-1 py-3 px-2 outline-none"
                    />
                    <button 
                      type="submit" 
                      disabled={loading}
                      className="bg-blue-600 hover:bg-blue-700 text-white px-6 py-3 rounded-lg font-bold flex items-center gap-2 transition-all disabled:opacity-50"
                    >
                      {loading ? "Joining..." : "Join Waitlist"}
                      <ChevronRight size={18} />
                    </button>
                  </div>
                  {error && <p className="text-red-500 text-sm mt-2">{error}</p>}
                </form>
              </div>
            )}
          </div>
        </motion.div>

        {/* Right Content - Image */}
        <motion.div 
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 1, delay: 0.2 }}
          className="relative group"
        >
          <div className="absolute inset-0 bg-gradient-to-tr from-blue-500/20 to-purple-500/20 rounded-3xl blur-[40px] opacity-30 group-hover:opacity-50 transition-opacity" />
          <div className="relative rounded-3xl border border-white/10 overflow-hidden shadow-2xl shadow-blue-500/10">
            <img 
              src="/commerium-mockup.png" 
              alt="Commerium AI Mockup" 
              className="w-full h-auto transform group-hover:scale-[1.02] transition-transform duration-700"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-[#050505] via-transparent to-transparent opacity-60" />
            
            <div className="absolute bottom-6 left-6 right-6 p-4 glass border-white/10 bg-black/40 backdrop-blur-xl">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-xs uppercase tracking-widest text-blue-400 font-bold mb-1">Status</p>
                  <p className="text-lg font-semibold flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-yellow-500 animate-pulse" />
                    Pending Shopify Review
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-xs uppercase tracking-widest text-gray-500 font-bold mb-1">Queue</p>
                  <p className="text-lg font-semibold">1,248 waiting</p>
                </div>
              </div>
            </div>
          </div>
        </motion.div>

      </div>

      {/* Footer */}
      <footer className="absolute bottom-8 text-gray-600 text-sm">
        © 2026 Commerium AI. All rights reserved.
      </footer>

      <style jsx>{`
        .gradient-text {
          background: linear-gradient(to right, #0072f5, #7928ca);
          -webkit-background-clip: text;
          -webkit-text-fill-color: transparent;
        }
        .glass {
          background: rgba(255, 255, 255, 0.03);
          backdrop-filter: blur(16px);
          -webkit-backdrop-filter: blur(16px);
          border: 1px solid rgba(255, 255, 255, 0.1);
          border-radius: 16px;
        }
      `}</style>
    </div>
  );
}
